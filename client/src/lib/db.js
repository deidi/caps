import Dexie from 'dexie';
import QRCode from 'qrcode';

export const db = new Dexie('caps_v2_db');

db.version(1).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at',
  photos: '++id, event_slug, guest_id, guest_name, hash, status, created_at',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});

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
    const total_photos = await db.photos.where('event_slug').equals(e.slug).count();
    const approved_photos = await db.photos.where({ event_slug: e.slug, status: 'approved' }).count();
    const pending_photos = await db.photos.where({ event_slug: e.slug, status: 'pending' }).count();
    const total_guests = await db.guests.where('event_slug').equals(e.slug).count();

    return {
      ...e,
      total_photos,
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
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    throw new Error('Event not found');
  }

  const total_photos = await db.photos.where('event_slug').equals(slug).count();
  const approved_photos = await db.photos.where({ event_slug: slug, status: 'approved' }).count();
  const pending_photos = await db.photos.where({ event_slug: slug, status: 'pending' }).count();
  const total_guests = await db.guests.where('event_slug').equals(slug).count();

  return {
    success: true,
    event: {
      ...event,
      total_photos,
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
  const join_url = `${origin}/#/event/${slug}`;
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
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const guestName = (name || '').trim() || 'Guest';
  const token = 'guest_' + Math.random().toString(36).substring(2) + Date.now();

  const guestRecord = {
    event_slug: slug,
    name: guestName,
    token,
    upload_count: 0,
    created_at: new Date().toISOString()
  };

  const id = await db.guests.add(guestRecord);
  localStorage.setItem(`caps_guest_${slug}`, token);

  return {
    success: true,
    guest: {
      id,
      ...guestRecord
    }
  };
}

/**
 * Get guest session
 */
export async function getGuestSession(slug, guestToken) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  if (!guestToken) {
    return { success: false, error: 'No guest token provided' };
  }

  const guest = await db.guests.where({ event_slug: slug, token: guestToken }).first();
  if (!guest) {
    return { success: false, error: 'Guest session expired or not found' };
  }

  return {
    success: true,
    guest,
    event
  };
}

/**
 * Get event analytics summary
 */
export async function getEventAnalytics(slug) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const total_photos = await db.photos.where('event_slug').equals(slug).count();
  const approved_photos = await db.photos.where({ event_slug: slug, status: 'approved' }).count();
  const pending_photos = await db.photos.where({ event_slug: slug, status: 'pending' }).count();
  const total_guests = await db.guests.where('event_slug').equals(slug).count();

  return {
    success: true,
    analytics: {
      total_photos,
      approved_photos,
      pending_photos,
      total_guests,
      storage_size_bytes: 0
    }
  };
}
