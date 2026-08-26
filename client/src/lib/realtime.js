import mqtt from 'mqtt';
import { db, blobToBase64, base64ToBlob, getCachedObjectURL } from './db.js';
import {
  getStoredDriveToken,
  setupEventDriveHierarchy,
  createResumableUploadSession,
  getDriveCDNUrl,
  getDriveThumbnailUrl
} from './gdrive.js';

/**
 * Ultra-Lightweight Real-time PubSub Event Bus
 * Handles Google Drive cloud uploads with direct fallback signaling.
 */
export function initRealtimeHub(slug, options = {}) {
  if (!slug) return null;

  const isHost = Boolean(options.isHost);
  const onMessage = options.onMessage || (() => {});
  const onStatusChange = options.onStatusChange || (() => {});
  const onPeerCountChange = options.onPeerCountChange || (() => {});

  let isDestroyed = false;
  const activePeers = new Set();
  const pendingSessionRequests = new Map();

  const myClientId = 'client_' + Math.random().toString(36).substring(2, 10);
  const topicBase = `eventcaps_${slug}`;
  const topicBroadcast = `${topicBase}/broadcast`;
  const topicPhotos = `${topicBase}/photos`;
  const topicGDriveReq = `${topicBase}/gdrive_req`;
  const topicGDriveReadyPattern = `${topicBase}/gdrive_ready/+`;
  const topicGDriveDone = `${topicBase}/gdrive_done`;
  const topicJoins = `${topicBase}/joins`;
  const topicPresence = `${topicBase}/presence/+`;
  const myPresenceTopic = `${topicBase}/presence/${myClientId}`;

  // Local BroadcastChannel for instant same-browser multi-tab sync
  let localChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      localChannel = new BroadcastChannel(`eventcaps_rt_${slug}`);
      localChannel.onmessage = async (event) => {
        if (event.data && !isDestroyed) {
          if (event.data.type === 'local:gdrive-req' && isHost) {
            await handleIncomingGDriveRequest(event.data.payload);
          } else if (event.data.type === 'local:gdrive-ready' && !isHost) {
            handleGDriveReadyResponse(event.data.payload);
          } else if (event.data.type === 'local:gdrive-done' && isHost) {
            await handleIncomingGDriveDone(event.data.payload);
          } else if (event.data.type === 'local:photo-direct' && isHost) {
            await handleIncomingDirectPhoto(event.data.payload);
          } else {
            onMessage(event.data);
          }
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // Connect to lightweight enterprise WebSocket broker (EMQX)
  const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  onStatusChange('connecting');

  let client = null;
  try {
    client = mqtt.connect(brokerUrl, {
      clientId: `eventcaps_${isHost ? 'host' : 'guest'}_${myClientId}`,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 2500,
      keepalive: 45
    });

    client.on('connect', () => {
      if (isDestroyed) return;
      onStatusChange('connected');
      onPeerCountChange(1);

      client.subscribe([
        topicBroadcast,
        topicPhotos,
        topicGDriveReq,
        topicGDriveReadyPattern,
        topicGDriveDone,
        topicJoins,
        topicPresence
      ], (err) => {
        if (err) console.warn('MQTT subscribe warning:', err);
      });

      // Presence heartbeat
      client.publish(myPresenceTopic, JSON.stringify({
        senderId: myClientId,
        role: isHost ? 'host' : 'guest',
        timestamp: Date.now()
      }));

      if (isHost) {
        broadcastApprovedGallery();
      }
    });

    client.on('message', async (topic, messageBuffer) => {
      if (isDestroyed) return;
      try {
        const payload = JSON.parse(messageBuffer.toString());
        if (payload.senderId === myClientId) return;

        if (topic === topicBroadcast) {
          if (payload.msg) {
            onMessage(payload.msg);
          }
        } else if (topic === topicPhotos && isHost) {
          if (payload.photo) {
            await handleIncomingDirectPhoto(payload.photo);
          }
        } else if (topic === topicGDriveReq && isHost) {
          if (payload.req) {
            await handleIncomingGDriveRequest(payload.req);
          }
        } else if (topic.startsWith(`${topicBase}/gdrive_ready/`) && !isHost) {
          if (payload.ready) {
            handleGDriveReadyResponse(payload.ready);
          }
        } else if (topic === topicGDriveDone && isHost) {
          if (payload.done) {
            await handleIncomingGDriveDone(payload.done);
          }
        } else if (topic === topicJoins && isHost) {
          if (payload.guest) {
            await handleIncomingGuestJoin(payload.guest);
          }
        } else if (topic.startsWith(`${topicBase}/presence/`)) {
          if (payload.senderId && payload.senderId !== myClientId) {
            activePeers.add(payload.senderId);
            onPeerCountChange(activePeers.size + 1);
            if (isHost) {
              broadcastApprovedGallery();
            }
          }
        }
      } catch (err) {
        console.warn('Realtime message parse error:', err);
      }
    });

    client.on('offline', () => {
      if (!isDestroyed) onStatusChange('reconnecting');
    });

    client.on('reconnect', () => {
      if (!isDestroyed) onStatusChange('reconnecting');
    });

    client.on('error', (err) => {
      console.warn('Realtime broker warning:', err.message);
    });
  } catch (err) {
    console.error('Failed to initialize realtime connection:', err);
  }

  // --- GOOGLE DRIVE SESSION COORDINATION ---
  async function handleIncomingGDriveRequest(req) {
    if (!isHost || isDestroyed) return;
    try {
      const token = getStoredDriveToken();
      if (!token) {
        publishGDriveReady(req.requestId, { requestId: req.requestId, disabled: true });
        return;
      }

      const event = await db.events.where('slug').equals(slug).first();
      const eventName = event ? event.name : slug;

      if (req.hash) {
        const existing = await db.photos.where('hash').equals(req.hash).first();
        if (existing) {
          publishGDriveReady(req.requestId, { requestId: req.requestId, duplicate: true });
          return;
        }
      }

      const { originalsFolderId, thumbnailsFolderId } = await setupEventDriveHierarchy(slug, eventName);

      const [origUploadUri, thumbUploadUri] = await Promise.all([
        createResumableUploadSession({
          folderId: originalsFolderId,
          fileName: req.filename || `photo_${Date.now()}.jpg`,
          mimeType: req.mimeType || 'image/jpeg',
          fileSize: req.origSize
        }),
        createResumableUploadSession({
          folderId: thumbnailsFolderId,
          fileName: `thumb_${req.filename || Date.now()}.jpg`,
          mimeType: 'image/jpeg',
          fileSize: req.thumbSize
        })
      ]);

      const readyPayload = {
        requestId: req.requestId,
        origUploadUri,
        thumbUploadUri
      };

      publishGDriveReady(req.requestId, readyPayload);
    } catch (err) {
      console.error('Failed to create Drive resumable session for guest:', err);
      publishGDriveReady(req.requestId, { requestId: req.requestId, error: err.message });
    }
  }

  function publishGDriveReady(requestId, readyPayload) {
    const topic = `${topicBase}/gdrive_ready/${requestId}`;
    if (client && client.connected) {
      client.publish(topic, JSON.stringify({
        senderId: myClientId,
        ready: readyPayload
      }));
    }
    if (localChannel) {
      localChannel.postMessage({
        type: 'local:gdrive-ready',
        payload: readyPayload
      });
    }
  }

  function handleGDriveReadyResponse(readyPayload) {
    if (!readyPayload || !readyPayload.requestId) return;
    const resolver = pendingSessionRequests.get(readyPayload.requestId);
    if (resolver) {
      pendingSessionRequests.delete(readyPayload.requestId);
      resolver(readyPayload);
    }
  }

  async function handleIncomingGDriveDone(donePayload) {
    if (!isHost || isDestroyed) return;
    try {
      const {
        driveOrigId,
        driveThumbId,
        filename,
        hash,
        width,
        height,
        size,
        mimeType,
        guest_name,
        guest_token,
        thumbDataUrl
      } = donePayload;

      let event = await db.events.where('slug').equals(slug).first();
      const initialStatus = (!event || !event.moderation_enabled) ? 'approved' : 'pending';
      const now = new Date().toISOString();

      let guest = null;
      if (guest_token) {
        guest = await db.guests.where('token').equals(guest_token).first();
        if (!guest) {
          const guestId = await db.guests.add({
            event_slug: slug,
            name: guest_name || 'Guest',
            token: guest_token,
            upload_count: 1,
            created_at: now
          });
          guest = { id: guestId, name: guest_name, token: guest_token, upload_count: 1 };
        } else {
          await db.guests.update(guest.id, { upload_count: (guest.upload_count || 0) + 1 });
        }
      }

      const driveOrigUrl = driveOrigId ? getDriveCDNUrl(driveOrigId, 2048) : '';
      const driveThumbUrl = driveThumbId ? getDriveThumbnailUrl(driveThumbId, 400) : driveOrigUrl;

      const photoRecord = {
        event_slug: slug,
        guest_id: guest ? guest.id : null,
        guest_name: guest_name || (guest ? guest.name : 'Guest'),
        filename: filename || `photo_${Date.now()}.jpg`,
        hash,
        status: initialStatus,
        width: width || 2048,
        height: height || 1536,
        size: size || 0,
        mime_type: mimeType || 'image/jpeg',
        drive_orig_id: driveOrigId,
        drive_thumb_id: driveThumbId,
        drive_orig_url: driveOrigUrl,
        drive_thumb_url: driveThumbUrl,
        created_at: now
      };

      const id = await db.photos.add(photoRecord);

      const formattedPhoto = {
        id,
        ...photoRecord,
        thumbDataUrl,
        original_url: driveOrigUrl,
        thumb_url: driveThumbUrl,
        original_path: driveOrigUrl,
        thumbnail_path: driveThumbUrl
      };

      onMessage({
        type: 'photo:uploaded',
        payload: formattedPhoto
      });

      if (initialStatus === 'approved' && client && client.connected) {
        client.publish(topicBroadcast, JSON.stringify({
          senderId: myClientId,
          msg: {
            type: 'photo:approved',
            payload: formattedPhoto
          }
        }));
      }
    } catch (err) {
      console.error('Failed to handle gdrive:done payload:', err);
    }
  }

  // --- FALLBACK DIRECT PHOTO STREAMING ---
  async function handleIncomingDirectPhoto(photoData) {
    if (!isHost || isDestroyed) return;
    try {
      const {
        filename,
        guest_name,
        guest_token,
        hash,
        width,
        height,
        size,
        mimeType,
        thumbDataUrl,
        originalDataUrl
      } = photoData;

      let event = await db.events.where('slug').equals(slug).first();
      const existing = await db.photos.where('hash').equals(hash).first();
      if (existing) return;

      const initialStatus = (!event || !event.moderation_enabled) ? 'approved' : 'pending';
      const now = new Date().toISOString();

      let guest = null;
      if (guest_token) {
        guest = await db.guests.where('token').equals(guest_token).first();
        if (!guest) {
          const guestId = await db.guests.add({
            event_slug: slug,
            name: guest_name || 'Guest',
            token: guest_token,
            upload_count: 1,
            created_at: now
          });
          guest = { id: guestId, name: guest_name, token: guest_token, upload_count: 1 };
        } else {
          await db.guests.update(guest.id, { upload_count: (guest.upload_count || 0) + 1 });
        }
      }

      const origBlob = originalDataUrl ? base64ToBlob(originalDataUrl) : null;
      const thumbBlob = thumbDataUrl ? base64ToBlob(thumbDataUrl) : null;

      const photoRecord = {
        event_slug: slug,
        guest_id: guest ? guest.id : null,
        guest_name: guest_name || (guest ? guest.name : 'Guest'),
        filename: filename || `photo_${Date.now()}.jpg`,
        hash,
        status: initialStatus,
        width: width || 2048,
        height: height || 1536,
        size: size || 0,
        mime_type: mimeType || 'image/jpeg',
        original_blob: origBlob,
        thumb_blob: thumbBlob,
        created_at: now
      };

      const id = await db.photos.add(photoRecord);

      const origUrl = origBlob ? getCachedObjectURL(origBlob, `orig_${id}`) : thumbDataUrl;
      const thumbUrl = thumbBlob ? getCachedObjectURL(thumbBlob, `thumb_${id}`) : thumbDataUrl;

      const formattedPhoto = {
        id,
        ...photoRecord,
        thumbDataUrl,
        original_url: origUrl,
        thumb_url: thumbUrl,
        original_path: origUrl,
        thumbnail_path: thumbUrl
      };

      onMessage({
        type: 'photo:uploaded',
        payload: formattedPhoto
      });

      if (initialStatus === 'approved' && client && client.connected) {
        client.publish(topicBroadcast, JSON.stringify({
          senderId: myClientId,
          msg: {
            type: 'photo:approved',
            payload: formattedPhoto
          }
        }));
      }
    } catch (err) {
      console.error('Failed to handle direct photo payload:', err);
    }
  }

  async function handleIncomingGuestJoin(guestData) {
    try {
      const existing = await db.guests.where('token').equals(guestData.token).first();
      if (!existing) {
        await db.guests.add({
          event_slug: slug,
          name: guestData.name,
          token: guestData.token,
          upload_count: 0,
          created_at: new Date().toISOString()
        });
      }
      onMessage({
        type: 'guest:joined',
        payload: guestData
      });
      if (isHost) {
        broadcastApprovedGallery();
      }
    } catch (e) {
      console.error('Error handling guest join:', e);
    }
  }

  async function broadcastApprovedGallery() {
    if (!isHost || isDestroyed || !client || !client.connected) return;
    try {
      const event = await db.events.where('slug').equals(slug).first();
      const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
      const approved = allPhotos.filter(p => p.status === 'approved');

      const payloadPhotos = [];
      for (const p of approved) {
        let thumbDataUrl = '';
        if (p.thumb_blob) {
          thumbDataUrl = await blobToBase64(p.thumb_blob);
        }
        payloadPhotos.push({
          id: p.id,
          hash: p.hash,
          event_slug: p.event_slug,
          guest_name: p.guest_name,
          status: 'approved',
          created_at: p.created_at,
          filename: p.filename,
          drive_orig_id: p.drive_orig_id,
          drive_thumb_id: p.drive_thumb_id,
          drive_orig_url: p.drive_orig_url,
          drive_thumb_url: p.drive_thumb_url,
          thumb_url: p.drive_thumb_url || p.drive_orig_url || thumbDataUrl,
          original_url: p.drive_orig_url || '',
          thumbDataUrl
        });
      }

      client.publish(`${topicBase}/broadcast`, JSON.stringify({
        senderId: myClientId,
        msg: {
          type: 'gallery:synced',
          payload: {
            photos: payloadPhotos,
            event_settings: event ? {
              slug: event.slug,
              name: event.name,
              date: event.date,
              tagline: event.tagline,
              guest_upload_limit: Number(event.guest_upload_limit) || 20,
              moderation_enabled: Boolean(event.moderation_enabled),
              status: event.status
            } : null
          }
        }
      }));
    } catch (err) {
      console.warn('Failed to broadcast approved gallery:', err);
    }
  }

  return {
    send: (msg) => {
      if (isDestroyed || !msg) return;
      if (client && client.connected) {
        client.publish(topicBroadcast, JSON.stringify({
          senderId: myClientId,
          msg
        }));
      }
      if (localChannel) {
        localChannel.postMessage(msg);
      }
    },

    notifyGuestJoin: (guestData) => {
      if (isDestroyed || !guestData) return;
      if (client && client.connected) {
        client.publish(topicJoins, JSON.stringify({
          senderId: myClientId,
          guest: guestData
        }));
      }
      if (localChannel) {
        localChannel.postMessage({ type: 'guest:joined', payload: guestData });
      }
    },

    requestGDriveUploadSession: async (photoMeta, guestInfo) => {
      const requestId = 'req_' + Math.random().toString(36).substring(2, 12);
      const sessionPromise = new Promise((resolve) => {
        pendingSessionRequests.set(requestId, resolve);
        setTimeout(() => {
          if (pendingSessionRequests.has(requestId)) {
            pendingSessionRequests.delete(requestId);
            resolve(null);
          }
        }, 4000);
      });

      const gdriveReqPayload = {
        requestId,
        filename: photoMeta.filename,
        mimeType: photoMeta.mimeType || 'image/jpeg',
        origSize: photoMeta.origSize,
        thumbSize: photoMeta.thumbSize,
        hash: photoMeta.hash,
        guestInfo
      };

      if (client && client.connected) {
        client.publish(topicGDriveReq, JSON.stringify({
          senderId: myClientId,
          req: gdriveReqPayload
        }));
      }

      if (localChannel) {
        localChannel.postMessage({
          type: 'local:gdrive-req',
          payload: gdriveReqPayload
        });
      }

      return sessionPromise;
    },

    notifyGDrivePhotoUploaded: (donePayload) => {
      if (client && client.connected) {
        client.publish(topicGDriveDone, JSON.stringify({
          senderId: myClientId,
          done: donePayload
        }));
      }
      if (localChannel) {
        localChannel.postMessage({
          type: 'local:gdrive-done',
          payload: donePayload
        });
      }
    },

    sendPhotoDirect: (photoPayload) => {
      if (client && client.connected) {
        client.publish(topicPhotos, JSON.stringify({
          senderId: myClientId,
          photo: photoPayload
        }));
      }
      if (localChannel) {
        localChannel.postMessage({
          type: 'local:photo-direct',
          payload: photoPayload
        });
      }
    },

    disconnect: () => {
      isDestroyed = true;
      if (localChannel) {
        localChannel.close();
      }
      if (client) {
        try {
          client.end(true);
        } catch (e) {}
      }
      onStatusChange('disconnected');
    }
  };
}
