import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'caps.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host_name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    session_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    date TEXT,
    cover_photo TEXT,
    logo TEXT,
    tagline TEXT,
    moderation_enabled INTEGER DEFAULT 1,
    guest_upload_limit INTEGER DEFAULT 20,
    exif_strip INTEGER DEFAULT 0,
    slideshow_interval INTEGER DEFAULT 5,
    slideshow_transition TEXT DEFAULT 'fade',
    slideshow_show_qr INTEGER DEFAULT 1,
    slideshow_show_author INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    upload_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    guest_id INTEGER,
    filename TEXT NOT NULL,
    hash TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    original_path TEXT NOT NULL,
    thumbnail_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS drive_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    drive_file_id TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photos_event_status ON photos(event_id, status);
  CREATE INDEX IF NOT EXISTS idx_photos_hash ON photos(event_id, hash);
  CREATE INDEX IF NOT EXISTS idx_guests_event_token ON guests(event_id, token);
`);

// Safe column migrations for existing databases
const migrations = [
  "ALTER TABLE events ADD COLUMN slideshow_interval INTEGER DEFAULT 5;",
  "ALTER TABLE events ADD COLUMN slideshow_transition TEXT DEFAULT 'fade';",
  "ALTER TABLE events ADD COLUMN slideshow_show_qr INTEGER DEFAULT 1;",
  "ALTER TABLE events ADD COLUMN slideshow_show_author INTEGER DEFAULT 1;",
  "ALTER TABLE events ADD COLUMN primary_color TEXT DEFAULT '#2563EB';",
  "ALTER TABLE settings ADD COLUMN google_client_id TEXT;",
  "ALTER TABLE settings ADD COLUMN google_client_secret TEXT;",
  "ALTER TABLE settings ADD COLUMN google_refresh_token TEXT;",
  "ALTER TABLE settings ADD COLUMN google_access_token TEXT;",
  "ALTER TABLE settings ADD COLUMN google_token_expiry INTEGER;",
  "ALTER TABLE settings ADD COLUMN google_account_email TEXT;"
];

for (const migration of migrations) {
  try {
    db.exec(migration);
  } catch (e) {
    // Column already exists, ignore
  }
}

import { syncConfigWithDb } from './config.js';
syncConfigWithDb(db);

export default db;
