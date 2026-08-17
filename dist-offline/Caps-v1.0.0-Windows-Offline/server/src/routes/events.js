import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import multer from 'multer';
import sharp from 'sharp';
import db from '../db.js';
import { requireHostAuth } from './auth.js';
import { getLocalIpAddress, generateQRCodeBuffer, generateQRCodeDataURL, generateGuestToken } from '../utils.js';
import { broadcastToEvent, broadcastToHosts } from '../ws.js';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max for logo
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRootDir = path.resolve(__dirname, '../../data');

const router = express.Router();

function getDirSizeBytes(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSizeBytes(fullPath);
      } else if (entry.isFile()) {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch (e) {
    console.error('Error calculating directory size:', e);
  }
  return size;
}

function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function getUniqueSlug(baseName) {
  let baseSlug = slugify(baseName) || 'event';
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!existing) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

// GET /api/events - List all events with statistics
router.get('/', (req, res) => {
  try {
    const events = db.prepare(`
      SELECT 
        e.*,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as total_photos,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id AND status = 'approved') as approved_photos,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id AND status = 'pending') as pending_photos,
        (SELECT COUNT(*) FROM guests WHERE event_id = e.id) as total_guests
      FROM events e
      ORDER BY e.created_at DESC
    `).all();

    res.json({
      success: true,
      events
    });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

// GET /api/events/:slug - Get single event by slug
router.get('/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const event = db.prepare(`
      SELECT 
        e.*,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as total_photos,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id AND status = 'approved') as approved_photos,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id AND status = 'pending') as pending_photos,
        (SELECT COUNT(*) FROM guests WHERE event_id = e.id) as total_guests
      FROM events e
      WHERE e.slug = ?
    `).get(slug);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    res.json({
      success: true,
      event
    });
  } catch (err) {
    console.error('Error fetching event:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch event' });
  }
});

// POST /api/events - Create a new event (host auth required)
router.post('/', requireHostAuth, (req, res) => {
  try {
    const {
      name,
      date,
      cover_photo,
      logo,
      tagline,
      moderation_enabled = 1,
      guest_upload_limit = 20,
      exif_strip = 0
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Event name is required' });
    }

    const trimmedName = String(name).trim();
    const eventDate = date ? String(date).trim() : new Date().toISOString().split('T')[0];
    const slug = getUniqueSlug(trimmedName);

    const result = db.prepare(`
      INSERT INTO events (
        name, slug, date, cover_photo, logo, tagline,
        moderation_enabled, guest_upload_limit, exif_strip, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      trimmedName,
      slug,
      eventDate,
      cover_photo || null,
      logo || null,
      tagline || null,
      Number(moderation_enabled) ? 1 : 0,
      Number(guest_upload_limit) || 20,
      Number(exif_strip) ? 1 : 0
    );

    const createdEvent = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      event: createdEvent
    });
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

// GET /api/events/:slug/qr - Generate QR code for event
router.get('/:slug/qr', async (req, res) => {
  try {
    const { slug } = req.params;
    const { format = 'dataurl', host_type = 'ip' } = req.query;

    const event = db.prepare('SELECT id, name, slug FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const port = req.socket.localPort || 1000;
    const localIp = getLocalIpAddress();
    const reqHost = req.get('host');

    // Build URL options
    const ipUrl = `http://${localIp}:${port}/event/${event.slug}`;
    const currentHostUrl = reqHost ? `${req.protocol}://${reqHost}/event/${event.slug}` : ipUrl;
    const targetUrl = host_type === 'current' ? currentHostUrl : ipUrl;

    if (format === 'png' || req.headers.accept === 'image/png') {
      const buffer = await generateQRCodeBuffer(targetUrl, { width: 512 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="caps-qr-${event.slug}.png"`);
      return res.send(buffer);
    }

    const qrDataUrl = await generateQRCodeDataURL(targetUrl, { width: 400 });

    res.json({
      success: true,
      event: { id: event.id, name: event.name, slug: event.slug },
      join_url: targetUrl,
      qr_data_url: qrDataUrl,
      network_urls: {
        ip_url: ipUrl,
        current_url: currentHostUrl
      }
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// POST /api/events/:slug/join - Guest joins an event
router.post('/:slug/join', (req, res) => {
  try {
    const { slug } = req.params;
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Your name is required to join' });
    }

    const trimmedName = String(name).trim().substring(0, 50);

    const event = db.prepare(`
      SELECT id, name, slug, date, cover_photo, logo, tagline, moderation_enabled, guest_upload_limit, status
      FROM events
      WHERE slug = ?
    `).get(slug);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event space not found' });
    }

    if (event.status === 'archived') {
      return res.status(400).json({ success: false, error: 'This event has ended and is read-only' });
    }

    const guestToken = generateGuestToken();

    const insert = db.prepare(`
      INSERT INTO guests (event_id, name, token, upload_count)
      VALUES (?, ?, ?, 0)
    `).run(event.id, trimmedName, guestToken);

    const guest = db.prepare('SELECT id, event_id, name, token, upload_count, created_at FROM guests WHERE id = ?').get(insert.lastInsertRowid);

    res.status(201).json({
      success: true,
      guest,
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        date: event.date,
        cover_photo: event.cover_photo,
        logo: event.logo,
        tagline: event.tagline,
        guest_upload_limit: event.guest_upload_limit,
        moderation_enabled: event.moderation_enabled
      }
    });
  } catch (err) {
    console.error('Error joining event:', err);
    res.status(500).json({ success: false, error: 'Failed to join event space' });
  }
});

// GET /api/events/:slug/guest-session - Check existing guest session
router.get('/:slug/guest-session', (req, res) => {
  try {
    const { slug } = req.params;
    const guestToken = req.headers['x-guest-token'] || req.query.token;

    if (!guestToken) {
      return res.status(401).json({ success: false, error: 'Missing guest token' });
    }

    const event = db.prepare('SELECT id, name, slug, date, cover_photo, logo, tagline, guest_upload_limit, moderation_enabled, status FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const guest = db.prepare('SELECT id, event_id, name, token, upload_count, created_at FROM guests WHERE event_id = ? AND token = ?').get(event.id, String(guestToken).trim());
    if (!guest) {
      return res.status(401).json({ success: false, error: 'Invalid or expired guest token' });
    }

    res.json({
      success: true,
      guest,
      event,
      quota: {
        used: guest.upload_count,
        limit: event.guest_upload_limit,
        remaining: Math.max(0, event.guest_upload_limit - guest.upload_count)
      }
    });
  } catch (err) {
    console.error('Error validating guest session:', err);
    res.status(500).json({ success: false, error: 'Failed to validate guest session' });
  }
});

// GET /api/events/:slug/slideshow-config - Get slideshow display configuration
router.get('/:slug/slideshow-config', async (req, res) => {
  try {
    const { slug } = req.params;
    const event = db.prepare(`
      SELECT id, name, slug, tagline, slideshow_interval, slideshow_transition, slideshow_show_qr, slideshow_show_author
      FROM events WHERE slug = ?
    `).get(slug);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const localIp = getLocalIpAddress();
    const port = process.env.PORT || 1000;
    const joinUrl = `http://${localIp}:${port}/event/${event.slug}`;
    const qrDataUrl = await generateQRCodeDataURL(joinUrl, 250);

    res.json({
      success: true,
      config: {
        interval: event.slideshow_interval || 5,
        transition: event.slideshow_transition || 'fade',
        show_qr: Boolean(event.slideshow_show_qr ?? 1),
        show_author: Boolean(event.slideshow_show_author ?? 1),
        join_url: joinUrl,
        qr_data_url: qrDataUrl
      }
    });
  } catch (err) {
    console.error('Error fetching slideshow config:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch slideshow config' });
  }
});

// PATCH /api/events/:slug/slideshow-config - Update slideshow configuration (Host Only)
router.patch('/:slug/slideshow-config', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const { interval, transition, show_qr, show_author } = req.body;

    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const validTransitions = ['fade', 'slide', 'zoom'];
    const safeInterval = interval !== undefined ? Math.max(2, Math.min(60, Number(interval) || 5)) : null;
    const safeTransition = transition !== undefined && validTransitions.includes(transition) ? transition : null;
    const safeShowQr = show_qr !== undefined ? (show_qr ? 1 : 0) : null;
    const safeShowAuthor = show_author !== undefined ? (show_author ? 1 : 0) : null;

    if (safeInterval !== null) {
      db.prepare('UPDATE events SET slideshow_interval = ? WHERE id = ?').run(safeInterval, event.id);
    }
    if (safeTransition !== null) {
      db.prepare('UPDATE events SET slideshow_transition = ? WHERE id = ?').run(safeTransition, event.id);
    }
    if (safeShowQr !== null) {
      db.prepare('UPDATE events SET slideshow_show_qr = ? WHERE id = ?').run(safeShowQr, event.id);
    }
    if (safeShowAuthor !== null) {
      db.prepare('UPDATE events SET slideshow_show_author = ? WHERE id = ?').run(safeShowAuthor, event.id);
    }

    const updated = db.prepare(`
      SELECT slideshow_interval, slideshow_transition, slideshow_show_qr, slideshow_show_author
      FROM events WHERE id = ?
    `).get(event.id);

    const config = {
      interval: updated.slideshow_interval,
      transition: updated.slideshow_transition,
      show_qr: Boolean(updated.slideshow_show_qr),
      show_author: Boolean(updated.slideshow_show_author)
    };

    res.json({
      success: true,
      config
    });
  } catch (err) {
    console.error('Error updating slideshow config:', err);
    res.status(500).json({ success: false, error: 'Failed to update slideshow config' });
  }
});

// PATCH /api/events/:slug/status - Close / Archive or Reopen Event (Host Only)
router.patch('/:slug/status', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const { status } = req.body;

    if (!['active', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be active or archived' });
    }

    const event = db.prepare('SELECT id, name, slug FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, event.id);

    broadcastToEvent(slug, 'event:status-changed', { slug, status });
    broadcastToHosts('event:status-changed', { slug, status });

    res.json({
      success: true,
      event: { ...event, status },
      message: status === 'archived' ? 'Event has been closed/archived.' : 'Event has been reopened.'
    });
  } catch (err) {
    console.error('Error updating event status:', err);
    res.status(500).json({ success: false, error: 'Failed to update event status' });
  }
});

// DELETE /api/events/:slug - Full Delete Event and Storage (Host Only)
router.delete('/:slug', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;

    const event = db.prepare('SELECT id, name FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // 1. Delete SQLite record (cascades to guests, photos, drive_sync_log)
    db.prepare('DELETE FROM events WHERE id = ?').run(event.id);

    // 2. Delete event directory on disk
    const eventDiskDir = path.join(dataRootDir, 'events', slug);
    if (fs.existsSync(eventDiskDir)) {
      try {
        fs.rmSync(eventDiskDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`Error deleting disk folder for event ${slug}:`, e);
      }
    }

    broadcastToEvent(slug, 'event:deleted', { slug });
    broadcastToHosts('event:deleted', { slug });

    res.json({
      success: true,
      message: `Event "${event.name}" and all associated files deleted successfully.`
    });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
});

// GET /api/events/:slug/analytics - Event Analytics (Host Only)
router.get('/:slug/analytics', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;

    const event = db.prepare('SELECT id, name, slug, created_at, guest_upload_limit, moderation_enabled, status FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Photo counts breakdown
    const photoCounts = db.prepare(`
      SELECT 
        COUNT(*) as total_photos,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM photos
      WHERE event_id = ?
    `).get(event.id);

    // Guest stats
    const guestStats = db.prepare(`
      SELECT COUNT(*) as unique_guests FROM guests WHERE event_id = ?
    `).get(event.id);

    // Top contributors leaderboard
    const topContributors = db.prepare(`
      SELECT g.name, COUNT(p.id) as count
      FROM photos p
      JOIN guests g ON p.guest_id = g.id
      WHERE p.event_id = ?
      GROUP BY g.id
      ORDER BY count DESC
      LIMIT 10
    `).all(event.id);

    // Uploads over time (grouped by hour)
    const uploadsTimeline = db.prepare(`
      SELECT strftime('%H:00', created_at) as hour, COUNT(*) as count
      FROM photos
      WHERE event_id = ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(event.id);

    // Storage used
    const eventDiskDir = path.join(dataRootDir, 'events', slug);
    const storageBytes = getDirSizeBytes(eventDiskDir);
    const storageMb = Math.round((storageBytes / (1024 * 1024)) * 100) / 100;

    res.json({
      success: true,
      analytics: {
        total_photos: photoCounts.total_photos || 0,
        approved: photoCounts.approved || 0,
        pending: photoCounts.pending || 0,
        rejected: photoCounts.rejected || 0,
        unique_guests: guestStats.unique_guests || 0,
        top_contributors: topContributors || [],
        uploads_over_time: uploadsTimeline || [],
        storage_used_mb: storageMb,
        storage_used_bytes: storageBytes
      }
    });
  } catch (err) {
    console.error('Error generating event analytics:', err);
    res.status(500).json({ success: false, error: 'Failed to generate event analytics' });
  }
});

// GET /api/events/:slug/export - Full Event Export ZIP (Photos + Metadata JSON) (Host Only)
router.get('/:slug/export', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;

    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const guests = db.prepare('SELECT id, name, token, upload_count, created_at FROM guests WHERE event_id = ?').all(event.id);
    const photos = db.prepare(`
      SELECT p.*, g.name as guest_name
      FROM photos p
      LEFT JOIN guests g ON p.guest_id = g.id
      WHERE p.event_id = ?
    `).all(event.id);

    const exportMetadata = {
      app: 'Caps',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      event,
      summary: {
        total_guests: guests.length,
        total_photos: photos.length,
        approved_photos: photos.filter(p => p.status === 'approved').length,
        pending_photos: photos.filter(p => p.status === 'pending').length,
        rejected_photos: photos.filter(p => p.status === 'rejected').length
      },
      guests,
      photos
    };

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="caps-${slug}-full-export.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    // 1. Add metadata.json
    archive.append(JSON.stringify(exportMetadata, null, 2), { name: 'metadata.json' });

    // 2. Add original photos
    const originalsDir = path.join(dataRootDir, 'events', slug, 'originals');
    if (fs.existsSync(originalsDir)) {
      archive.directory(originalsDir, 'originals');
    }

    // 3. Add thumbnails
    const thumbnailsDir = path.join(dataRootDir, 'events', slug, 'thumbnails');
    if (fs.existsSync(thumbnailsDir)) {
      archive.directory(thumbnailsDir, 'thumbnails');
    }

    archive.finalize();
  } catch (err) {
    console.error('Error generating full event export ZIP:', err);
    res.status(500).json({ success: false, error: 'Failed to generate event export' });
  }
});



// POST /api/events/:slug/logo - Upload custom event logo (Host only)
router.post('/:slug/logo', requireHostAuth, logoUpload.single('logo'), async (req, res) => {
  try {
    const { slug } = req.params;
    const event = db.prepare('SELECT id, name, slug FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No logo image file provided' });
    }

    const eventDir = path.join(dataRootDir, 'events', slug);
    if (!fs.existsSync(eventDir)) {
      fs.mkdirSync(eventDir, { recursive: true });
    }

    const logoFilename = `logo-${Date.now()}.png`;
    const logoFilePath = path.join(eventDir, logoFilename);

    // Optimize and resize logo to max 400x400 with PNG transparency
    await sharp(req.file.buffer)
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .png({ quality: 90 })
      .toFile(logoFilePath);

    const logoPublicUrl = `/data/events/${slug}/${logoFilename}`;

    db.prepare('UPDATE events SET logo = ? WHERE id = ?').run(logoPublicUrl, event.id);

    broadcastToEvent(slug, 'event:branding-updated', {
      slug,
      logo: logoPublicUrl
    });

    res.json({
      success: true,
      logo: logoPublicUrl,
      message: 'Event logo updated successfully'
    });
  } catch (err) {
    console.error('Error uploading event logo:', err);
    res.status(500).json({ success: false, error: 'Failed to upload event logo: ' + err.message });
  }
});

// DELETE /api/events/:slug/logo - Remove custom event logo (Host only)
router.delete('/:slug/logo', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const event = db.prepare('SELECT id, logo FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    db.prepare('UPDATE events SET logo = NULL WHERE id = ?').run(event.id);

    broadcastToEvent(slug, 'event:branding-updated', {
      slug,
      logo: null
    });

    res.json({
      success: true,
      message: 'Event logo removed'
    });
  } catch (err) {
    console.error('Error removing event logo:', err);
    res.status(500).json({ success: false, error: 'Failed to remove event logo' });
  }
});

// PATCH /api/events/:slug/branding - Update tagline and theme color (Host only)
router.patch('/:slug/branding', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const { tagline, primary_color } = req.body;
    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    db.prepare(`
      UPDATE events 
      SET tagline = COALESCE(?, tagline),
          primary_color = COALESCE(?, primary_color)
      WHERE id = ?
    `).run(tagline !== undefined ? tagline : null, primary_color || null, event.id);

    const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(event.id);

    broadcastToEvent(slug, 'event:branding-updated', {
      slug,
      tagline: updated.tagline,
      primary_color: updated.primary_color,
      logo: updated.logo
    });

    res.json({
      success: true,
      event: updated,
      message: 'Event branding updated successfully'
    });
  } catch (err) {
    console.error('Error updating event branding:', err);
    res.status(500).json({ success: false, error: 'Failed to update event branding' });
  }
});

// GET /api/events/:slug/download-all - Stream ZIP of all approved photos
router.get('/:slug/download-all', (req, res) => {
  res.redirect(`/api/events/${req.params.slug}/photos/download-all`);
});

export default router;
