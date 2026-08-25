import mqtt from 'mqtt';
import { db, getCachedObjectURL } from './db.js';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(';base64,');
  const contentType = parts[0].split(':')[1] || 'image/jpeg';
  const raw = window.atob(parts[1] || '');
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return new Blob([uInt8Array], { type: contentType });
}

/**
 * Initialize High-Speed Realtime WebSocket Hub for an event
 */
export function initP2PMesh(slug, options = {}) {
  if (!slug) return null;

  const isHost = Boolean(options.isHost);
  const onMessage = options.onMessage || (() => {});
  const onStatusChange = options.onStatusChange || (() => {});
  const onPeerCountChange = options.onPeerCountChange || (() => {});

  let isDestroyed = false;
  const activePeers = new Set();

  const myClientId = 'peer_' + Math.random().toString(36).substring(2, 10);
  const topicBase = `caps_v2_${slug}`;
  const topicBroadcast = `${topicBase}/broadcast`;
  const topicPhotos = `${topicBase}/photos`;
  const topicJoins = `${topicBase}/joins`;
  const topicSyncReq = `${topicBase}/sync_req`;
  const topicGallerySync = `${topicBase}/gallery_sync`;
  const topicGalleryReq = `${topicBase}/gallery_req`;
  const topicPresence = `${topicBase}/presence/+`;
  const myPresenceTopic = `${topicBase}/presence/${myClientId}`;

  // Local BroadcastChannel for instant same-browser multi-tab sync
  let localChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      localChannel = new BroadcastChannel(`caps_local_${slug}`);
      localChannel.onmessage = async (event) => {
        if (event.data && !isDestroyed) {
          if (event.data.type === 'local:photo-streamed' && isHost) {
            const photoData = event.data.payload;
            if (photoData) {
              await handleIncomingPhotoPayload(photoData);
            }
          } else {
            onMessage(event.data);
          }
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // Connect to global enterprise WebSocket broker (EMQX)
  const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  onStatusChange('connecting');

  let client = null;
  try {
    client = mqtt.connect(brokerUrl, {
      clientId: `caps_${isHost ? 'host' : 'guest'}_${myClientId}`,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 2500,
      keepalive: 45
    });

    client.on('connect', () => {
      if (isDestroyed) return;
      onStatusChange('connected');
      onPeerCountChange(1);

      // Subscribe to all event channels
      client.subscribe([topicBroadcast, topicPhotos, topicJoins, topicSyncReq, topicGallerySync, topicGalleryReq, topicPresence], (err) => {
        if (err) console.warn('MQTT subscribe warning:', err);
      });

      // Broadcast presence announcement
      client.publish(myPresenceTopic, JSON.stringify({
        senderId: myClientId,
        role: isHost ? 'host' : 'guest',
        timestamp: Date.now()
      }));

      if (isHost) {
        // Host requests connected guests to push photos
        client.publish(topicSyncReq, JSON.stringify({
          senderId: myClientId,
          timestamp: Date.now()
        }));
        // Broadcast existing approved photos
        broadcastApprovedGalleryToPeers();
      } else {
        // Guest asks Host for latest approved gallery photos
        client.publish(topicGalleryReq, JSON.stringify({
          senderId: myClientId,
          timestamp: Date.now()
        }));
        // Guest pushes any local photos
        syncLocalPhotosToPeers();
      }
    });

    client.on('message', async (topic, messageBuffer) => {
      if (isDestroyed) return;
      try {
        const payload = JSON.parse(messageBuffer.toString());
        if (payload.senderId === myClientId) return; // Ignore own echoes

        if (topic === topicBroadcast) {
          if (payload.msg) {
            onMessage(payload.msg);
          }
        } else if (topic === topicGallerySync && !isHost) {
          if (payload.photos) {
            onMessage({
              type: 'gallery:synced',
              payload: { photos: payload.photos }
            });
          }
        } else if (topic === topicGalleryReq && isHost) {
          await broadcastApprovedGalleryToPeers();
        } else if (topic === topicPhotos && isHost) {
          if (payload.photo) {
            await handleIncomingPhotoPayload(payload.photo);
          }
        } else if (topic === topicJoins && isHost) {
          if (payload.guest) {
            await handleIncomingGuestJoin(payload.guest);
          }
        } else if (topic === topicSyncReq && !isHost) {
          await syncLocalPhotosToPeers();
        } else if (topic.startsWith(`${topicBase}/presence/`)) {
          if (payload.senderId && payload.senderId !== myClientId) {
            activePeers.add(payload.senderId);
            onPeerCountChange(activePeers.size + 1);
            if (isHost) {
              await broadcastApprovedGalleryToPeers();
            } else {
              syncLocalPhotosToPeers();
            }
          }
        }
      } catch (err) {
        console.warn('Failed to parse incoming realtime packet:', err);
      }
    });

    async function broadcastApprovedGalleryToPeers() {
      if (!isHost || isDestroyed || !client || !client.connected) return;
      try {
        const event = await db.events.where('slug').equals(slug).first();
        const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
        const approved = allPhotos.filter(p => p.status === 'approved');

        const payloadPhotos = [];
        for (const p of approved) {
          let thumbDataUrl = p.thumbDataUrl;
          if (!thumbDataUrl && p.thumb_blob) {
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
            thumbDataUrl
          });
        }

        client.publish(topicGallerySync, JSON.stringify({
          senderId: myClientId,
          photos: payloadPhotos,
          event_settings: event ? {
            name: event.name,
            tagline: event.tagline,
            guest_upload_limit: event.guest_upload_limit,
            moderation_enabled: event.moderation_enabled,
            status: event.status
          } : null
        }));
      } catch (err) {
        console.warn('Failed to broadcast approved gallery:', err);
      }
    }

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
      // Push latest approved photos to newly joined guest
      if (isHost) {
        broadcastApprovedGalleryToPeers();
      }
    } catch (e) {
      console.error('Error handling guest join:', e);
    }
  }

  async function handleIncomingPhotoPayload(photoData) {
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
        originalDataUrl,
        thumbDataUrl
      } = photoData;

      let event = await db.events.where('slug').equals(slug).first();
      if (!event) {
        const formattedName = slug
          .split('-')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');
        event = {
          slug,
          name: formattedName,
          date: new Date().toISOString().split('T')[0],
          tagline: 'Memories Shared in Real-Time',
          moderation_enabled: true,
          guest_upload_limit: 20,
          status: 'active',
          created_at: new Date().toISOString()
        };
        await db.events.put(event);
      }

      // Duplicate check in host's database
      const existingPhoto = await db.photos.where('hash').equals(hash).first();
      if (existingPhoto) return;

      const originalBlob = base64ToBlob(originalDataUrl);
      const thumbBlob = base64ToBlob(thumbDataUrl);
      if (!originalBlob || !thumbBlob) return;

      // Find or associate guest
      let guest = null;
      if (guest_token) {
        guest = await db.guests.where('token').equals(guest_token).first();
        if (!guest) {
          const guestId = await db.guests.add({
            event_slug: slug,
            name: guest_name || 'Guest',
            token: guest_token,
            upload_count: 1,
            created_at: new Date().toISOString()
          });
          guest = { id: guestId, name: guest_name, token: guest_token, upload_count: 1 };
        } else {
          await db.guests.update(guest.id, { upload_count: (guest.upload_count || 0) + 1 });
        }
      }

      const initialStatus = (!event.moderation_enabled) ? 'approved' : 'pending';
      const now = new Date().toISOString();

      const photoRecord = {
        event_slug: slug,
        guest_id: guest ? guest.id : null,
        guest_name: guest_name || (guest ? guest.name : 'Guest'),
        filename: filename || `photo_${Date.now()}.jpg`,
        hash,
        status: initialStatus,
        width: width || 2048,
        height: height || 1536,
        size: size || originalBlob.size,
        mime_type: mimeType || 'image/jpeg',
        original_blob: originalBlob,
        thumb_blob: thumbBlob,
        created_at: now
      };

      const id = await db.photos.add(photoRecord);

      const origUrl = getCachedObjectURL(originalBlob, `orig_${id}`);
      const thumbUrl = getCachedObjectURL(thumbBlob, `thumb_${id}`);

      const formattedPhoto = {
        id,
        ...photoRecord,
        thumbDataUrl,
        original_url: origUrl,
        thumb_url: thumbUrl,
        original_path: origUrl,
        thumbnail_path: thumbUrl,
        original_blob: undefined,
        thumb_blob: undefined
      };

      // Notify host UI of incoming photo in the queue
      onMessage({
        type: 'photo:uploaded',
        payload: formattedPhoto
      });

      // If moderation is disabled, auto-broadcast approved status to all other peers
      if (!event.moderation_enabled && client && client.connected) {
        client.publish(topicBroadcast, JSON.stringify({
          senderId: myClientId,
          msg: {
            type: 'photo:approved',
            payload: formattedPhoto
          }
        }));
      }
    } catch (err) {
      console.error('Failed to process incoming photo payload:', err);
    }
  }

  async function syncLocalPhotosToPeers() {
    if (isHost || isDestroyed) return;
    try {
      const guestToken = localStorage.getItem(`caps_guest_${slug}`);
      const photos = await db.photos.where('event_slug').equals(slug).toArray();
      let guestName = 'Guest';
      if (guestToken) {
        const guest = await db.guests.where({ event_slug: slug, token: guestToken }).first();
        if (guest) guestName = guest.name;
      }

      for (const photo of photos) {
        if (photo.original_blob && photo.thumb_blob) {
          await streamPhotoToHost({
            filename: photo.filename,
            hash: photo.hash,
            width: photo.width,
            height: photo.height,
            size: photo.size,
            mimeType: photo.mime_type,
            originalBlob: photo.original_blob,
            thumbBlob: photo.thumb_blob
          }, {
            name: photo.guest_name || guestName,
            token: guestToken || ''
          });
        }
      }
    } catch (err) {
      console.warn('Auto-sync photos error:', err);
    }
  }

  async function streamPhotoToHost(processedPhoto, guestInfo, onProgress) {
    if (isDestroyed) return;

    const originalDataUrl = await blobToBase64(processedPhoto.originalBlob);
    const thumbDataUrl = await blobToBase64(processedPhoto.thumbBlob);

    const payload = {
      filename: processedPhoto.filename,
      guest_name: guestInfo.name,
      guest_token: guestInfo.token,
      hash: processedPhoto.hash,
      width: processedPhoto.width,
      height: processedPhoto.height,
      size: processedPhoto.size,
      mimeType: processedPhoto.mimeType || 'image/jpeg',
      originalDataUrl,
      thumbDataUrl
    };

    if (onProgress) onProgress(100);

    // Publish to MQTT photos topic
    if (client && client.connected) {
      client.publish(topicPhotos, JSON.stringify({
        senderId: myClientId,
        photo: payload
      }));
    }

    // Also mirror to local BroadcastChannel for same-browser testing
    if (localChannel) {
      localChannel.postMessage({
        type: 'local:photo-streamed',
        payload
      });
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

    streamPhotoToHost,

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
