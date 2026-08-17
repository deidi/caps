import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { computeFileHash, processAndSavePhoto } from '../thumbnail.js';
import { requireHostAuth } from './auth.js';
import { broadcastToEvent, broadcastToHosts } from '../ws.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRootDir = path.resolve(__dirname, '../../data');

const router = express.Router({ mergeParams: true });

// Memory storage for fast processing with Sharp before persisting
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB max per image
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WEBP, and HEIC images are allowed'));
    }
  }
});

// Helper to authenticate guest or host
function getGuestOrHost(req, eventId) {
  const guestToken = req.headers['x-guest-token'] || req.query.guest_token;
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const settings = db.prepare('SELECT session_token FROM settings WHERE id = 1').get();
    if (settings && settings.session_token === token) {
      return { isHost: true, guest: null };
    }
  }

  if (guestToken) {
    const guest = db.prepare('SELECT * FROM guests WHERE event_id = ? AND token = ?').get(eventId, String(guestToken).trim());
    if (guest) {
      return { isHost: false, guest };
    }
  }

  return { isHost: false, guest: null };
}

// POST /api/events/:slug/photos - Upload a photo (Guest or Host)
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { slug } = req.params;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No image file uploaded' });
    }

    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    if (event.status === 'archived') {
      return res.status(400).json({ success: false, error: 'Event is archived. Uploads are disabled.' });
    }

    const { isHost, guest } = getGuestOrHost(req, event.id);

    if (!isHost && !guest) {
      return res.status(401).json({ success: false, error: 'Please enter your name to upload photos' });
    }

    // Check guest upload quota
    if (!isHost && guest) {
      if (guest.upload_count >= event.guest_upload_limit) {
        return res.status(400).json({
          success: false,
          error: `Upload limit reached (${event.guest_upload_limit} photos). Delete earlier photos to free up slots.`
        });
      }
    }

    // 1. Compute Hash for Duplicate Detection
    const hash = computeFileHash(req.file.buffer);
    const existingPhoto = db.prepare('SELECT id FROM photos WHERE event_id = ? AND hash = ?').get(event.id, hash);

    if (existingPhoto) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate photo: This exact image has already been uploaded to this event'
      });
    }

    // 2. Process and Save Original + 300px Thumbnail
    const result = await processAndSavePhoto({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname || 'photo.jpg',
      eventSlug: event.slug,
      dataRootDir,
      stripExif: Boolean(event.exif_strip)
    });

    // 3. Initial Status: Moderation on -> 'pending', Moderation off -> 'approved'
    const initialStatus = (isHost || !event.moderation_enabled) ? 'approved' : 'pending';
    const guestId = guest ? guest.id : null;

    // 4. Insert into database
    const insert = db.prepare(`
      INSERT INTO photos (
        event_id, guest_id, filename, hash, status,
        original_path, thumbnail_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      guestId,
      result.filename,
      result.hash,
      initialStatus,
      result.originalRelativePath,
      result.thumbnailRelativePath
    );

    // 5. Update guest upload count
    if (guest) {
      db.prepare('UPDATE guests SET upload_count = upload_count + 1 WHERE id = ?').run(guest.id);
    }

    const createdPhoto = db.prepare(`
      SELECT p.*, g.name as guest_name
      FROM photos p
      LEFT JOIN guests g ON p.guest_id = g.id
      WHERE p.id = ?
    `).get(insert.lastInsertRowid);

    const updatedGuest = guest ? db.prepare('SELECT upload_count FROM guests WHERE id = ?').get(guest.id) : null;
    const usedCount = updatedGuest ? updatedGuest.upload_count : 0;

    // 6. Real-time WebSocket Broadcast
    if (initialStatus === 'approved') {
      broadcastToEvent(event.slug, 'photo:approved', createdPhoto);
    } else {
      broadcastToEvent(event.slug, 'photo:new-pending', createdPhoto);
      broadcastToHosts('photo:new-pending', { slug: event.slug, photo: createdPhoto });
    }

    res.status(201).json({
      success: true,
      photo: createdPhoto,
      quota: {
        used: usedCount,
        limit: event.guest_upload_limit,
        remaining: Math.max(0, event.guest_upload_limit - usedCount)
      },
      message: initialStatus === 'pending'
        ? 'Photo uploaded! Pending host approval before appearing on live gallery.'
        : 'Photo uploaded and published live!'
    });
  } catch (err) {
    console.error('Error handling photo upload:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to process and save photo' });
  }
});

// GET /api/events/:slug/photos - List photos (Filtered by status and/or guest)
router.get('/', (req, res) => {
  try {
    const { slug } = req.params;
    const { status, guest } = req.query;

    const event = db.prepare('SELECT id, guest_upload_limit FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const guestToken = req.headers['x-guest-token'] || req.query.guest_token;
    let guestRecord = null;
    if (guestToken) {
      guestRecord = db.prepare('SELECT id FROM guests WHERE event_id = ? AND token = ?').get(event.id, String(guestToken).trim());
    }

    let query = `
      SELECT p.*, g.name as guest_name
      FROM photos p
      LEFT JOIN guests g ON p.guest_id = g.id
      WHERE p.event_id = ?
    `;
    const params = [event.id];

    if (guest === 'me' && guestRecord) {
      query += ` AND p.guest_id = ?`;
      params.push(guestRecord.id);
    } else if (guest === 'me' && !guestRecord) {
      return res.json({ success: true, photos: [] });
    }

    if (status && status !== 'all') {
      query += ` AND p.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY p.created_at DESC`;

    const photos = db.prepare(query).all(...params);

    res.json({
      success: true,
      photos
    });
  } catch (err) {
    console.error('Error fetching photos:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
});

// PATCH /api/events/:slug/photos/bulk - Bulk approve or reject photos (Host Only)
router.patch('/bulk', requireHostAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Photo IDs array is required' });
    }

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE photos
      SET status = ?
      WHERE event_id = ? AND id IN (${placeholders})
    `).run(status, event.id, ...ids);

    const updatedPhotos = db.prepare(`
      SELECT p.*, g.name as guest_name
      FROM photos p
      LEFT JOIN guests g ON p.guest_id = g.id
      WHERE p.event_id = ? AND p.id IN (${placeholders})
    `).all(event.id, ...ids);

    if (status === 'approved') {
      broadcastToEvent(slug, 'photo:bulk-approved', { photos: updatedPhotos });
    } else {
      broadcastToEvent(slug, 'photo:bulk-removed', { ids });
    }
    broadcastToHosts('photo:bulk-status-changed', { slug, status, ids });

    res.json({
      success: true,
      updated_count: updatedPhotos.length,
      photos: updatedPhotos
    });
  } catch (err) {
    console.error('Error performing bulk photo update:', err);
    res.status(500).json({ success: false, error: 'Failed to bulk update photos' });
  }
});

// PATCH /api/events/:slug/photos/:id - Approve, reject, or revert photo (Host Only)
router.patch('/:id', requireHostAuth, (req, res) => {
  try {
    const { slug, id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be approved, rejected, or pending' });
    }

    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const existingPhoto = db.prepare('SELECT * FROM photos WHERE id = ? AND event_id = ?').get(id, event.id);
    if (!existingPhoto) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    db.prepare('UPDATE photos SET status = ? WHERE id = ?').run(status, id);

    const updatedPhoto = db.prepare(`
      SELECT p.*, g.name as guest_name
      FROM photos p
      LEFT JOIN guests g ON p.guest_id = g.id
      WHERE p.id = ?
    `).get(id);

    if (status === 'approved') {
      broadcastToEvent(slug, 'photo:approved', updatedPhoto);
    } else {
      broadcastToEvent(slug, 'photo:removed', { id: Number(id) });
    }
    broadcastToHosts('photo:status-changed', { slug, photo: updatedPhoto });

    res.json({
      success: true,
      photo: updatedPhoto
    });
  } catch (err) {
    console.error('Error updating photo status:', err);
    res.status(500).json({ success: false, error: 'Failed to update photo status' });
  }
});

// DELETE /api/events/:slug/photos/:id - Soft Delete Photo (Guest or Host)
router.delete('/:id', (req, res) => {
  try {
    const { slug, id } = req.params;

    const event = db.prepare('SELECT id, guest_upload_limit FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND event_id = ?').get(id, event.id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    const { isHost, guest } = getGuestOrHost(req, event.id);

    // If not host, guest can only delete their own photo
    if (!isHost) {
      if (!guest || photo.guest_id !== guest.id) {
        return res.status(403).json({ success: false, error: 'You can only delete your own photos' });
      }
    }

    // 1. Move file on disk to deleted/ folder
    const originalsDir = path.join(dataRootDir, 'events', slug, 'originals');
    const deletedDir = path.join(dataRootDir, 'events', slug, 'deleted');
    if (!fs.existsSync(deletedDir)) fs.mkdirSync(deletedDir, { recursive: true });

    const srcPath = path.join(originalsDir, photo.filename);
    const destPath = path.join(deletedDir, photo.filename);

    if (fs.existsSync(srcPath)) {
      try {
        fs.renameSync(srcPath, destPath);
      } catch (e) {
        // Fallback copy + unlink for cross-device files
        fs.copyFileSync(srcPath, destPath);
        fs.unlinkSync(srcPath);
      }
    }

    // 2. Remove photo record from database
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);

    // 3. Free guest upload slot
    if (photo.guest_id) {
      db.prepare('UPDATE guests SET upload_count = MAX(0, upload_count - 1) WHERE id = ?').run(photo.guest_id);
    }

    // 4. WebSocket broadcast removal
    broadcastToEvent(slug, 'photo:removed', { id: Number(photo.id) });
    broadcastToHosts('photo:deleted', { slug, id: Number(photo.id) });

    const updatedGuest = guest ? db.prepare('SELECT upload_count FROM guests WHERE id = ?').get(guest.id) : null;
    const usedCount = updatedGuest ? updatedGuest.upload_count : 0;

    res.json({
      success: true,
      message: 'Photo removed from gallery. Upload slot freed up.',
      quota: {
        used: usedCount,
        limit: event.guest_upload_limit,
        remaining: Math.max(0, event.guest_upload_limit - usedCount)
      }
    });
  } catch (err) {
    console.error('Error deleting photo:', err);
    res.status(500).json({ success: false, error: 'Failed to delete photo' });
  }
});

// GET /api/events/:slug/photos/:id/download - Serve full-res original
router.get('/:id/download', (req, res) => {
  try {
    const { slug, id } = req.params;
    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND event_id = ?').get(id, event.id);
    if (!photo) return res.status(404).json({ success: false, error: 'Photo not found' });

    const filePath = path.join(dataRootDir, 'events', slug, 'originals', photo.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Original file not found on disk' });
    }

    res.download(filePath, photo.filename);
  } catch (err) {
    console.error('Error serving photo download:', err);
    res.status(500).json({ success: false, error: 'Failed to download photo' });
  }
});

// POST /api/events/:slug/photos/download-zip - Stream ZIP of selected photos
router.post('/download-zip', (req, res) => {
  try {
    const { slug } = req.params;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Photo IDs array is required' });
    }

    const event = db.prepare('SELECT id, name FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    const placeholders = ids.map(() => '?').join(',');
    const photos = db.prepare(`SELECT * FROM photos WHERE event_id = ? AND id IN (${placeholders})`).all(event.id, ...ids);

    if (photos.length === 0) {
      return res.status(400).json({ success: false, error: 'No matching photos found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="caps-${slug}-selected.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const photo of photos) {
      const filePath = path.join(dataRootDir, 'events', slug, 'originals', photo.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: photo.filename });
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('Error creating ZIP archive:', err);
    res.status(500).json({ success: false, error: 'Failed to create ZIP archive' });
  }
});

// GET /api/events/:slug/photos/download-all - Stream ZIP of all approved photos
router.get('/download-all', (req, res) => {
  try {
    const { slug } = req.params;
    const event = db.prepare('SELECT id, name FROM events WHERE slug = ?').get(slug);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    const photos = db.prepare('SELECT * FROM photos WHERE event_id = ? AND status = ?').all(event.id, 'approved');

    if (photos.length === 0) {
      return res.status(400).json({ success: false, error: 'No approved photos in this event yet' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="caps-${slug}-memories.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const photo of photos) {
      const filePath = path.join(dataRootDir, 'events', slug, 'originals', photo.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: photo.filename });
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('Error creating download-all ZIP archive:', err);
    res.status(500).json({ success: false, error: 'Failed to create ZIP archive' });
  }
});

// GET /api/events/:slug/my-quota - Get guest quota status
router.get('/my-quota', (req, res) => {
  try {
    const { slug } = req.params;
    const guestToken = req.headers['x-guest-token'] || req.query.guest_token;

    const event = db.prepare('SELECT id, guest_upload_limit FROM events WHERE slug = ?').get(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    if (!guestToken) {
      return res.status(401).json({ success: false, error: 'Missing guest token' });
    }

    const guest = db.prepare('SELECT upload_count FROM guests WHERE event_id = ? AND token = ?').get(event.id, String(guestToken).trim());
    if (!guest) {
      return res.status(401).json({ success: false, error: 'Invalid guest token' });
    }

    res.json({
      success: true,
      quota: {
        used: guest.upload_count,
        limit: event.guest_upload_limit,
        remaining: Math.max(0, event.guest_upload_limit - guest.upload_count)
      }
    });
  } catch (err) {
    console.error('Error fetching quota:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch quota' });
  }
});

export default router;
