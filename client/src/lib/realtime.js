import mqtt from 'mqtt';
import { db, blobToBase64, base64ToBlob, getCachedObjectURL } from './db.js';

/**
 * Ultra-Lightweight Real-time PubSub Event Bus (Supabase Cloud Storage Integrated)
 * Optimized for 100+ concurrent guests: strictly delivers lightweight (<1KB) metadata.
 */
export function initRealtimeHub(slug, options = {}) {
  if (!slug) return null;

  const isHost = Boolean(options.isHost);
  const onMessage = options.onMessage || (() => {});
  const onStatusChange = options.onStatusChange || (() => {});
  const onPeerCountChange = options.onPeerCountChange || (() => {});

  let isDestroyed = false;
  const activePeers = new Set();

  const myClientId = 'client_' + Math.random().toString(36).substring(2, 10);
  const topicBase = `eventcaps_${slug}`;
  const topicBroadcast = `${topicBase}/broadcast`;
  const topicGalleryRetained = `${topicBase}/gallery_retained`;
  const topicGalleryReq = `${topicBase}/gallery_req`;
  const topicPhotos = `${topicBase}/photos`;
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
          if (event.data.type === 'local:photo-uploaded' && isHost) {
            await handleIncomingCloudPhoto(event.data.payload);
          } else if (event.data.type === 'local:gallery-req' && isHost) {
            await broadcastApprovedGallery();
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
      keepalive: 45,
    });

    client.on('connect', () => {
      if (isDestroyed) return;
      onStatusChange('connected');
      onPeerCountChange(1);

      client.subscribe(
        [
          topicBroadcast,
          topicGalleryRetained,
          topicGalleryReq,
          topicPhotos,
          topicJoins,
          topicPresence,
        ],
        (err) => {
          if (err) console.warn('MQTT subscribe warning:', err);

          // As soon as guest subscribes, request gallery sync from host
          if (!isHost) {
            requestGallerySync();
          }
        }
      );

      // Presence heartbeat
      client.publish(
        myPresenceTopic,
        JSON.stringify({
          senderId: myClientId,
          role: isHost ? 'host' : 'guest',
          timestamp: Date.now(),
        })
      );

      if (isHost) {
        broadcastApprovedGallery();
      }
    });

    client.on('message', async (topic, messageBuffer) => {
      if (isDestroyed) return;
      try {
        const payload = JSON.parse(messageBuffer.toString());
        if (payload.senderId === myClientId) return;

        if (topic === topicBroadcast || topic === topicGalleryRetained) {
          if (payload.msg) {
            onMessage(payload.msg);
          }
        } else if (topic === topicGalleryReq && isHost) {
          await broadcastApprovedGallery();
        } else if (topic === topicPhotos && isHost) {
          if (payload.photo) {
            await handleIncomingCloudPhoto(payload.photo);
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

  function requestGallerySync() {
    if (client && client.connected) {
      client.publish(
        topicGalleryReq,
        JSON.stringify({
          senderId: myClientId,
          timestamp: Date.now(),
        })
      );
    }
    if (localChannel) {
      localChannel.postMessage({
        type: 'local:gallery-req',
        payload: { senderId: myClientId },
      });
    }
  }

  async function handleIncomingCloudPhoto(photoData) {
    if (!isHost || isDestroyed) return;
    try {
      const {
        origUrl,
        thumbUrl,
        origPath,
        thumbPath,
        filename,
        hash,
        width,
        height,
        size,
        mimeType,
        guest_name,
        guest_token,
        thumbDataUrl,
      } = photoData;

      let event = await db.events.where('slug').equals(slug).first();
      const initialStatus = !event || !event.moderation_enabled ? 'approved' : 'pending';
      const now = new Date().toISOString();

      if (hash) {
        const existing = await db.photos.where('hash').equals(hash).first();
        if (existing) return;
      }

      let guest = null;
      if (guest_token) {
        guest = await db.guests.where('token').equals(guest_token).first();
        if (!guest) {
          const guestId = await db.guests.add({
            event_slug: slug,
            name: guest_name || 'Guest',
            token: guest_token,
            upload_count: 1,
            created_at: now,
          });
          guest = { id: guestId, name: guest_name, token: guest_token, upload_count: 1 };
        } else {
          await db.guests.update(guest.id, { upload_count: (guest.upload_count || 0) + 1 });
        }
      }

      const finalOrigUrl = origUrl || '';
      const finalThumbUrl = thumbUrl || finalOrigUrl;

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
        storage_orig_path: origPath || '',
        storage_thumb_path: thumbPath || '',
        storage_orig_url: finalOrigUrl,
        storage_thumb_url: finalThumbUrl,
        original_url: finalOrigUrl,
        thumb_url: finalThumbUrl,
        original_path: finalOrigUrl,
        thumbnail_path: finalThumbUrl,
        created_at: now,
      };

      const id = await db.photos.add(photoRecord);

      const formattedPhoto = {
        id,
        ...photoRecord,
        thumbDataUrl,
      };

      onMessage({
        type: 'photo:uploaded',
        payload: formattedPhoto,
      });

      if (initialStatus === 'approved') {
        broadcastApprovedGallery();
      }
    } catch (err) {
      console.error('Failed to handle incoming cloud photo:', err);
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
          created_at: new Date().toISOString(),
        });
      }
      onMessage({
        type: 'guest:joined',
        payload: guestData,
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
      const approved = allPhotos.filter((p) => p.status === 'approved');

      const payloadPhotos = [];
      for (const p of approved) {
        const thumbUrl = p.storage_thumb_url || p.thumb_url || p.storage_orig_url || p.original_url || '';
        const origUrl = p.storage_orig_url || p.original_url || thumbUrl;

        payloadPhotos.push({
          id: p.id,
          hash: p.hash,
          event_slug: p.event_slug,
          guest_name: p.guest_name,
          status: 'approved',
          created_at: p.created_at,
          filename: p.filename,
          storage_orig_url: p.storage_orig_url,
          storage_thumb_url: p.storage_thumb_url,
          thumb_url: thumbUrl,
          original_url: origUrl,
          thumbnail_path: thumbUrl,
          original_path: origUrl,
        });
      }

      const syncMsg = {
        type: 'gallery:synced',
        payload: {
          photos: payloadPhotos,
          event_settings: event
            ? {
                slug: event.slug,
                name: event.name,
                date: event.date,
                tagline: event.tagline,
                guest_upload_limit: Number(event.guest_upload_limit) || 20,
                moderation_enabled: Boolean(event.moderation_enabled),
                status: event.status,
              }
            : null,
        },
      };

      // 1. Broadcast live to active peers
      client.publish(
        `${topicBase}/broadcast`,
        JSON.stringify({
          senderId: myClientId,
          msg: syncMsg,
        })
      );

      // 2. Publish as retained message so ANY newly connecting peer gets it immediately
      client.publish(
        topicGalleryRetained,
        JSON.stringify({
          senderId: myClientId,
          msg: syncMsg,
        }),
        { retain: true, qos: 1 }
      );

      if (localChannel) {
        localChannel.postMessage(syncMsg);
      }
    } catch (err) {
      console.warn('Failed to broadcast approved gallery:', err);
    }
  }

  return {
    send: (msg) => {
      if (isDestroyed || !msg) return;
      if (client && client.connected) {
        client.publish(
          topicBroadcast,
          JSON.stringify({
            senderId: myClientId,
            msg,
          })
        );
      }
      if (localChannel) {
        localChannel.postMessage(msg);
      }
    },

    requestGallerySync,

    broadcastGallery: () => {
      if (isHost) broadcastApprovedGallery();
    },

    notifyGuestJoin: (guestData) => {
      if (isDestroyed || !guestData) return;
      if (client && client.connected) {
        client.publish(
          topicJoins,
          JSON.stringify({
            senderId: myClientId,
            guest: guestData,
          })
        );
      }
      if (localChannel) {
        localChannel.postMessage({ type: 'guest:joined', payload: guestData });
      }
    },

    notifyPhotoUploaded: (photoPayload) => {
      if (client && client.connected) {
        client.publish(
          topicPhotos,
          JSON.stringify({
            senderId: myClientId,
            photo: photoPayload,
          })
        );
      }
      if (localChannel) {
        localChannel.postMessage({
          type: 'local:photo-uploaded',
          payload: photoPayload,
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
    },
  };
}
