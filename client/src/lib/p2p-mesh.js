import { joinRoom } from 'trystero/nostr';
import { db, getCachedObjectURL } from './db.js';

const APP_ID = 'caps-photo-hub-v2';

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
  const contentType = (parts[0].split(':')[1]) || 'image/jpeg';
  const raw = window.atob(parts[1] || '');
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return new Blob([uInt8Array], { type: contentType });
}

/**
 * Initialize WebRTC P2P Mesh Room for an event
 */
export function initP2PMesh(slug, options = {}) {
  if (!slug) return null;

  const isHost = Boolean(options.isHost);
  const onMessage = options.onMessage || (() => {});
  const onStatusChange = options.onStatusChange || (() => {});
  const onPeerCountChange = options.onPeerCountChange || (() => {});

  let isDestroyed = false;
  const connectedPeers = new Set();

  // Local BroadcastChannel for instant same-browser multi-tab sync
  let localChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    localChannel = new BroadcastChannel(`caps_local_${slug}`);
    localChannel.onmessage = async (event) => {
      if (event.data && !isDestroyed) {
        if (event.data.type === 'local:photo-streamed' && isHost) {
          // Ingest local multi-tab photo
          const photoData = event.data.payload;
          if (photoData) {
            handleIncomingPhotoPayload(photoData);
          }
        } else {
          onMessage(event.data);
        }
      }
    };
  }

  // WebRTC Trystero Room using multiple high-availability Nostr relays
  const room = joinRoom({
    appId: APP_ID,
    relayUrls: [
      'wss://relay.damus.io',
      'wss://relay.snort.social',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://nostr.mom'
    ]
  }, `caps-room-${slug}`);

  onStatusChange('connecting');

  // 1. JSON Broadcast Action (photo status changes, moderation, event state)
  const [sendBroadcast, getBroadcast] = room.makeAction('broadcast');

  // 2. Binary Photo Transfer Action (transfers photo data URLs between guest and host)
  const [sendPhotoBinary, getPhotoBinary, onPhotoProgress] = room.makeAction('photo_binary');

  // 3. Guest Join Action
  const [sendGuestJoin, getGuestJoin] = room.makeAction('guest_join');

  // Handle incoming broadcast messages from peers
  getBroadcast((data, peerId) => {
    if (isDestroyed || !data) return;
    onMessage(data);
  });

  // Handle incoming guest joins (Host side)
  getGuestJoin(async (guestData, peerId) => {
    if (isDestroyed || !isHost || !guestData) return;
    try {
      // Record guest in host's IndexedDB
      const existing = await db.guests.where({ event_slug: slug, token: guestData.token }).first();
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
    } catch (e) {
      console.error('Error handling guest join over P2P:', e);
    }
  });

  async function handleIncomingPhotoPayload(payload) {
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
      } = payload;

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
      const existingPhoto = await db.photos.where({ event_slug: slug, hash }).first();
      if (existingPhoto) return;

      const originalBlob = base64ToBlob(originalDataUrl);
      const thumbBlob = base64ToBlob(thumbDataUrl);
      if (!originalBlob || !thumbBlob) return;

      // Find or associate guest
      let guest = null;
      if (guest_token) {
        guest = await db.guests.where({ event_slug: slug, token: guest_token }).first();
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
      if (!event.moderation_enabled) {
        sendBroadcast({
          type: 'photo:approved',
          payload: formattedPhoto
        });
      }
    } catch (err) {
      console.error('Failed to process incoming P2P photo binary:', err);
    }
  }

  // Handle incoming photo transfers (Host side)
  getPhotoBinary(async (payload, peerId) => {
    if (isDestroyed || !payload) return;
    await handleIncomingPhotoPayload(payload);
  });

  // Track connected peers
  room.onPeerJoin((peerId) => {
    if (isDestroyed) return;
    connectedPeers.add(peerId);
    onStatusChange('connected');
    onPeerCountChange(connectedPeers.size);
  });

  room.onPeerLeave((peerId) => {
    if (isDestroyed) return;
    connectedPeers.delete(peerId);
    if (connectedPeers.size === 0) {
      onStatusChange('waiting');
    }
    onPeerCountChange(connectedPeers.size);
  });

  return {
    /**
     * Send generic broadcast message across WebRTC mesh + local BroadcastChannel
     */
    send: (msg) => {
      if (isDestroyed || !msg) return;
      sendBroadcast(msg);
      if (localChannel) {
        localChannel.postMessage(msg);
      }
    },

    /**
     * Send guest join announcement
     */
    notifyGuestJoin: (guestData) => {
      if (isDestroyed || !guestData) return;
      sendGuestJoin(guestData);
      if (localChannel) {
        localChannel.postMessage({ type: 'guest:joined', payload: guestData });
      }
    },

    /**
     * Stream captured photo over WebRTC binary action
     */
    streamPhotoToHost: async (processedPhoto, guestInfo, onProgress) => {
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

      // Set up upload progress listener if provided
      if (onProgress) {
        onPhotoProgress((progress, peerId) => {
          onProgress(Math.round(progress * 100));
        });
      }

      // Stream to peers (host)
      await sendPhotoBinary(payload);

      // Also mirror to local BroadcastChannel for same-browser testing
      if (localChannel) {
        localChannel.postMessage({
          type: 'local:photo-streamed',
          payload
        });
      }
    },

    /**
     * Clean up and leave WebRTC mesh room
     */
    disconnect: () => {
      isDestroyed = true;
      connectedPeers.clear();
      if (localChannel) {
        localChannel.close();
      }
      room.leave();
      onStatusChange('disconnected');
    }
  };
}
