import Dexie from 'dexie';
import QRCode from 'qrcode';
import { processPhotoClient } from './photo-engine.js';

export const db = new Dexie('caps_v2_db');

db.version(1).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at, [event_slug+token]',
  photos: '++id, event_slug, guest_id, guest_name, hash, status, created_at, [event_slug+status], [event_slug+hash]',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});

export function blobToBase64(blob) {
  if (!blob) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(';base64,')) return null;
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

// Cache for Object URLs to avoid memory leaks and excessive URL creation
const objectUrlCache = new Map();

export function getCachedObjectURL(blob, key) {
  if (!blob) return '';
  if (objectUrlCache.has(key)) {
    return objectUrlCache.get(key);
  }
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, url);
  return url;
}

/**
 * Compute SHA-256 hash using native browser SubtleCrypto
 */
export async function sha256(text) {
  if (!text) return '';
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate clean URL slug from title
 */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Generate unique slug if duplicate exists
 */
export async function getUniqueSlug(baseName) {
  let baseSlug = slugify(baseName) || 'event';
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db.events.where('slug').equals(slug).first();
    if (!existing) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

/**
 * Get host setup and authentication status
 */
export async function getAuthStatus() {
  const setting = await db.settings.get(1);
  if (!setting || !setting.pin_hash) {
    return {
      initialized: false,
      is_authenticated: false,
      host_name: ''
    };
  }

  const sessionToken = localStorage.getItem('caps_host_token');
  const isAuthenticated = Boolean(sessionToken && sessionToken === setting.session_token);

  return {
    initialized: true,
    is_authenticated: isAuthenticated,
    host_name: setting.host_name || 'Host'
  };
}

/**
 * Setup host credentials (first run)
 */
export async function setupHost(host_name, pin) {
  const pin_hash = await sha256(pin);
  const session_token = 'host_token_' + Math.random().toString(36).substring(2) + Date.now();

  const existing = await db.settings.get(1);
  if (existing) {
    await db.settings.update(1, {
      host_name: host_name.trim(),
      pin_hash,
      session_token
    });
  } else {
    await db.settings.put({
      id: 1,
      host_name: host_name.trim(),
      pin_hash,
      session_token
    });
  }

  localStorage.setItem('caps_host_token', session_token);
  return { success: true, host_name, token: session_token };
}

/**
 * Verify host PIN
 */
export async function verifyPin(pin) {
  const setting = await db.settings.get(1);
  if (!setting) {
    throw new Error('Host is not configured yet');
  }

  const inputHash = await sha256(pin);
  if (inputHash !== setting.pin_hash) {
    throw new Error('Invalid PIN');
  }

  const session_token = 'host_token_' + Math.random().toString(36).substring(2) + Date.now();
  await db.settings.update(1, { session_token });
  localStorage.setItem('caps_host_token', session_token);

  return { success: true, token: session_token, host_name: setting.host_name };
}

/**
 * Get all events with summary stats
 */
export async function getEvents() {
  const events = await db.events.orderBy('created_at').reverse().toArray();

  const eventsWithStats = await Promise.all(events.map(async (e) => {
    const allPhotos = await db.photos.where('event_slug').equals(e.slug).toArray();
    const approved_photos = allPhotos.filter(p => p.status === 'approved').length;
    const pending_photos = allPhotos.filter(p => p.status === 'pending').length;
    const total_guests = await db.guests.where('event_slug').equals(e.slug).count();

    return {
      ...e,
      total_photos: allPhotos.length,
      approved_photos,
      pending_photos,
      total_guests
    };
  }));

  return { success: true, events: eventsWithStats };
}

/**
 * Get single event by slug
 */
export async function getEvent(slug) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    // For guest devices joining from another phone/device:
    // Dynamically initialize guest event space locally
    const formattedName = slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');

    const newGuestEvent = {
      slug,
      name: formattedName,
      date: new Date().toISOString().split('T')[0],
      tagline: 'Memories Shared in Real-Time',
      moderation_enabled: true,
      guest_upload_limit: 20,
      status: 'active',
      created_at: new Date().toISOString()
    };
    await db.events.put(newGuestEvent);
    event = newGuestEvent;
  }

  const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const approved_photos = allPhotos.filter(p => p.status === 'approved').length;
  const pending_photos = allPhotos.filter(p => p.status === 'pending').length;
  const total_guests = await db.guests.where('event_slug').equals(slug).count();

  return {
    success: true,
    event: {
      ...event,
      total_photos: allPhotos.length,
      approved_photos,
      pending_photos,
      total_guests
    }
  };
}

/**
 * Create a new event
 */
export async function createEvent(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Event name is required');

  const slug = await getUniqueSlug(name);
  const now = new Date().toISOString();

  const eventRecord = {
    slug,
    name,
    date: data.date || now.split('T')[0],
    tagline: data.tagline || '',
    moderation_enabled: data.moderation_enabled !== false,
    guest_upload_limit: parseInt(data.guest_upload_limit, 10) || 20,
    exif_strip: Boolean(data.exif_strip),
    status: 'active',
    created_at: now
  };

  const id = await db.events.add(eventRecord);
  return { success: true, event: { id, ...eventRecord } };
}

/**
 * Update event status (e.g. active, archived)
 */
export async function updateEventStatus(slug, status) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  await db.events.where('slug').equals(slug).modify({ status });
  return { success: true, status };
}

/**
 * Delete an event and associated photos/guests
 */
export async function deleteEvent(slug) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  await db.transaction('rw', [db.events, db.photos, db.guests, db.sync_logs], async () => {
    await db.events.where('slug').equals(slug).delete();
    await db.photos.where('event_slug').equals(slug).delete();
    await db.guests.where('event_slug').equals(slug).delete();
    await db.sync_logs.where('event_slug').equals(slug).delete();
  });

  return { success: true };
}

/**
 * Generate QR code data URL for guest joining
 */
export async function getEventQR(slug) {
  const origin = window.location.origin;
  const path = window.location.pathname;
  const basePath = path.endsWith('.html')
    ? path.substring(0, path.lastIndexOf('/'))
    : path.replace(/\/$/, '');

  const join_url = `${origin}${basePath}/#/event/${slug}`;
  const qr_data_url = await QRCode.toDataURL(join_url, {
    width: 400,
    margin: 2,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF'
    }
  });

  return {
    success: true,
    qr_data_url,
    join_url,
    host_type: 'web'
  };
}

/**
 * Guest join event
 */
export async function joinEvent(slug, name) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    const formattedName = slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
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

  const guestName = (name || '').trim() || 'Guest';
  
  // Check if this guest already exists for this event on this device
  const existingGuests = await db.guests.where('event_slug').equals(slug).toArray();
  const existingGuest = existingGuests.find(g => g.name.toLowerCase() === guestName.toLowerCase());

  let guestRecord;
  let token;

  // Calculate real photo count from IndexedDB
  const allEventPhotos = await db.photos.where('event_slug').equals(slug).toArray();

  if (existingGuest) {
    const realUploadCount = allEventPhotos.filter(
      p => p.guest_id === existingGuest.id || p.guest_name.toLowerCase() === guestName.toLowerCase()
    ).length;

    await db.guests.update(existingGuest.id, { upload_count: realUploadCount });
    existingGuest.upload_count = realUploadCount;
    token = existingGuest.token;
    guestRecord = existingGuest;
  } else {
    token = 'guest_' + Math.random().toString(36).substring(2) + Date.now();
    const realUploadCount = allEventPhotos.filter(
      p => (p.guest_name || '').toLowerCase() === guestName.toLowerCase()
    ).length;

    guestRecord = {
      event_slug: slug,
      name: guestName,
      token,
      upload_count: realUploadCount,
      created_at: new Date().toISOString()
    };
    const id = await db.guests.add(guestRecord);
    guestRecord.id = id;
  }

  localStorage.setItem(`caps_guest_${slug}`, token);

  const limit = Number(event.guest_upload_limit) || 20;
  const used = Number(guestRecord.upload_count) || 0;

  return {
    success: true,
    guest: guestRecord,
    event,
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used)
    }
  };
}

/**
 * Get guest session
 */
export async function getGuestSession(slug, guestToken) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    const formattedName = slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
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

  if (!guestToken) {
    return { success: false, error: 'No guest token provided' };
  }

  const guest = await db.guests.where('token').equals(guestToken).first();
  if (!guest) {
    return { success: false, error: 'Guest session expired or not found' };
  }

  // Ensure photo count reflects actual photos in IndexedDB
  const allEventPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const realUploadCount = allEventPhotos.filter(
    p => p.guest_id === guest.id || (p.guest_name && p.guest_name.toLowerCase() === guest.name.toLowerCase())
  ).length;

  if (guest.upload_count !== realUploadCount) {
    await db.guests.update(guest.id, { upload_count: realUploadCount });
    guest.upload_count = realUploadCount;
  }

  const limit = Number(event.guest_upload_limit) || 20;
  const used = Number(guest.upload_count) || 0;

  return {
    success: true,
    guest,
    event,
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used)
    }
  };
}

/**
 * Upload & process photo client-side
 */
export async function uploadPhoto(slug, file, guestToken) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');
  if (event.status === 'archived') throw new Error('Event is archived. Uploads are disabled.');

  const hostToken = localStorage.getItem('caps_host_token');
  const isHost = Boolean(hostToken);
  let guest = null;

  if (guestToken) {
    guest = await db.guests.where('token').equals(guestToken).first();
  }

  if (!isHost && !guest) {
    throw new Error('Please enter your name to upload photos');
  }

  // Check guest quota
  if (!isHost && guest) {
    if (guest.upload_count >= event.guest_upload_limit) {
      throw new Error(`Upload limit reached (${event.guest_upload_limit} photos). Delete earlier photos to free up slots.`);
    }
  }

  // Process photo client-side (resizing, thumbnails, duplicate hash, EXIF stripping)
  const processed = await processPhotoClient(file, {
    maxDimension: 2048,
    thumbDimension: 360,
    quality: 0.88,
    thumbQuality: 0.75,
    stripExif: event.exif_strip !== false
  });

  // Duplicate check
  const existing = await db.photos.where('hash').equals(processed.hash).first();
  if (existing) {
    throw new Error('This photo has already been uploaded to this event.');
  }

  const initialStatus = (!event.moderation_enabled || isHost) ? 'approved' : 'pending';
  const now = new Date().toISOString();

  const photoRecord = {
    event_slug: slug,
    guest_id: guest ? guest.id : null,
    guest_name: isHost ? 'Host' : (guest ? guest.name : 'Guest'),
    filename: processed.filename,
    hash: processed.hash,
    status: initialStatus,
    width: processed.width,
    height: processed.height,
    size: processed.size,
    mime_type: processed.mimeType,
    original_blob: processed.originalBlob,
    thumb_blob: processed.thumbBlob,
    created_at: now
  };

  const id = await db.photos.add(photoRecord);

  if (guest) {
    await db.guests.update(guest.id, {
      upload_count: (guest.upload_count || 0) + 1
    });
    guest.upload_count = (guest.upload_count || 0) + 1;
  }

  const originalUrl = getCachedObjectURL(processed.originalBlob, `orig_${id}`);
  const thumbUrl = getCachedObjectURL(processed.thumbBlob, `thumb_${id}`);

  const quota = guest ? {
    used: guest.upload_count,
    limit: event.guest_upload_limit,
    remaining: Math.max(0, event.guest_upload_limit - guest.upload_count)
  } : { used: 0, limit: 999, remaining: 999 };

  return {
    success: true,
    photo: {
      id,
      ...photoRecord,
      original_url: originalUrl,
      thumb_url: thumbUrl,
      original_path: originalUrl,
      thumbnail_path: thumbUrl,
      original_blob: undefined,
      thumb_blob: undefined
    },
    processed,
    quota
  };
}

/**
 * Get photos for an event
 */
export async function getPhotos(slug, options = {}) {
  let query = db.photos.where('event_slug').equals(slug);
  let photos = await query.toArray();

  if (options.status) {
    photos = photos.filter(p => p.status === options.status);
  }

  if (options.guest === 'me' && options.guestToken) {
    const guest = await db.guests.where('token').equals(options.guestToken).first();
    if (guest) {
      photos = photos.filter(p => p.guest_id === guest.id || (p.guest_name && p.guest_name.toLowerCase() === guest.name.toLowerCase()));
    }
  }

  photos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const result = photos.map(p => {
    const origUrl = getCachedObjectURL(p.original_blob, `orig_${p.id}`);
    const thumbUrl = getCachedObjectURL(p.thumb_blob, `thumb_${p.id}`);
    return {
      id: p.id,
      event_slug: p.event_slug,
      guest_id: p.guest_id,
      guest_name: p.guest_name,
      filename: p.filename,
      hash: p.hash,
      status: p.status,
      width: p.width,
      height: p.height,
      size: p.size,
      created_at: p.created_at,
      original_url: origUrl,
      thumb_url: thumbUrl,
      original_path: origUrl,
      thumbnail_path: thumbUrl
    };
  });

  return { success: true, photos: result };
}

/**
 * Delete a photo
 */
export async function deletePhoto(slug, photoId, guestToken) {
  const photo = await db.photos.get(parseInt(photoId, 10));
  if (!photo) throw new Error('Photo not found');

  const event = await db.events.where('slug').equals(slug).first();
  const limit = event ? event.guest_upload_limit : 20;
  let remaining = limit;
  let used = 0;

  if (photo.guest_id) {
    const guest = await db.guests.get(photo.guest_id);
    if (guest) {
      const newCount = Math.max(0, (guest.upload_count || 1) - 1);
      await db.guests.update(guest.id, { upload_count: newCount });
      used = newCount;
      remaining = Math.max(0, limit - newCount);
    }
  }

  await db.photos.delete(photo.id);

  return {
    success: true,
    quota: {
      used,
      limit,
      remaining
    }
  };
}

/**
 * Get event analytics summary
 */
export async function getEventAnalytics(slug) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const photos = await db.photos.where('event_slug').equals(slug).toArray();
  const total_photos = photos.length;
  const approved_photos = photos.filter(p => p.status === 'approved').length;
  const pending_photos = photos.filter(p => p.status === 'pending').length;
  const total_guests = await db.guests.where('event_slug').equals(slug).count();
  const storage_size_bytes = photos.reduce((acc, p) => acc + (p.size || 0), 0);

  return {
    success: true,
    analytics: {
      total_photos,
      approved_photos,
      pending_photos,
      total_guests,
      storage_size_bytes
    }
  };
}
