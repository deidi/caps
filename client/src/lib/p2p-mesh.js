import { joinRoom } from 'trystero/nostr';
import { db, getCachedObjectURL } from './db.js';

const APP_ID = 'caps-photo-hub-v2';

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
    localChannel.onmessage = (event) => {
      if (event.data && !isDestroyed) {
        onMessage(event.data);
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

  // 2. Binary Photo Transfer Action (transfers photo blobs between guest and host)
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

  // Handle incoming photo transfers (Host side)
  getPhotoBinary(async (payload, peerId) => {
    if (isDestroyed || !payload) return;

    try {
      // Reconstruct photo record
      const {
        filename,
        guest_name,
        guest_token,
        hash,
        width,
        height,
        size,
        mimeType,
        originalBuffer,
        thumbBuffer
      } = payload;

      const event = await db.events.where('slug').equals(slug).first();
      if (!event) return;

      // Duplicate check in host's database
      const existingPhoto = await db.photos.where({ event_slug: slug, hash }).first();
      if (existingPhoto) return;

      const originalBlob = new Blob([originalBuffer], { type: mimeType || 'image/jpeg' });
      const thumbBlob = new Blob([thumbBuffer], { type: 'image/jpeg' });

      // Find or associate guest
      let guest = null;
      if (guest_token) {
        guest = await db.guests.where({ event_slug: slug, token: guest_token }).first();
      }

      const initialStatus = (isHost || !event.moderation_enabled) ? 'approved' : 'pending';
      const now = new Date().toISOString();

      const photoRecord = {
        event_slug: slug,
        guest_id: guest ? guest.id : null,
        guest_name: guest_name || (guest ? guest.name : 'Guest'),
        filename,
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

      if (guest) {
        await db.guests.update(guest.id, { upload_count: (guest.upload_count || 0) + 1 });
      }

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

      // Notify host UI of incoming photo
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

      const originalBuffer = await processedPhoto.originalBlob.arrayBuffer();
      const thumbBuffer = await processedPhoto.thumbBlob.arrayBuffer();

      const payload = {
        filename: processedPhoto.filename,
        guest_name: guestInfo.name,
        guest_token: guestInfo.token,
        hash: processedPhoto.hash,
        width: processedPhoto.width,
        height: processedPhoto.height,
        size: processedPhoto.size,
        mimeType: processedPhoto.mimeType,
        originalBuffer,
        thumbBuffer
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
          payload: {
            ...processedPhoto,
            guest_name: guestInfo.name,
            guest_token: guestInfo.token
          }
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
