# Caps — Agent Onboarding Guide

> **READ THIS FIRST** before making any changes to the Caps codebase.

## What is Caps?

Caps is a **local-network-first photo sharing PWA** for church events. A host runs a server on their Windows laptop, guests scan a QR code on their phones, upload photos, and everyone sees a live gallery. The host can sync photos to Google Drive after the event.

**Primary user:** NCCF (New Creation Christian Fellowship) — non-technical church staff running events.

## Architecture (Do Not Deviate)

```
```
Windows Launcher (.bat / .ps1 / .exe)
  └── Express server (port 1000)
       ├── REST API (/api/*)
       ├── WebSocket (live gallery updates at /ws)
       ├── Static file server (serves Svelte 5 PWA)
       ├── SQLite database (file-based in data/caps.db)
       ├── Sharp (thumbnail generation & EXIF stripping)
       └── LAN Discovery (Direct LAN IP routing)

Svelte 5 PWA (client/)
  ├── Host dashboard (event mgmt, approval queue, analytics, Drive sync, branding)
  └── Guest pages (join event, upload photos, live gallery, TV slideshow, PWA install)
```

## Tech Stack — Locked

| Layer | Technology | Do NOT substitute |
|---|---|---|
| Backend runtime | Node.js (v20+) | ❌ No Deno, Bun |
| HTTP framework | Express | ❌ No Fastify, Koa, Hono |
| Database | SQLite (node:sqlite / better-sqlite3) | ❌ No Postgres, MongoDB, Prisma |
| Real-time | ws (WebSocket) | ❌ No Socket.io, SSE |
| Image processing | Sharp | ❌ No Jimp, ImageMagick |
| Frontend | Svelte 5 + Vite | ❌ No React, Vue, Angular |
| QR generation | qrcode (npm) | |
| ZIP creation | archiver (npm) | |
| Google Drive | Google Drive REST API / OAuth2 | |
| Network discovery | Direct LAN IP Routing | |
| Desktop packaging | pkg / Batch / PowerShell Launchers | ❌ No Electron, Tauri |

## Project Structure

```
Caps/
├── server/
│   ├── src/
│   │   ├── index.js          # Entry point — Express + WebSocket + Static SPA
│   │   ├── launcher.js       # Auto-opens browser to http://localhost:1000
│   │   ├── config.js         # JSON config loader & DB synchronizer
│   │   ├── reset-db.js       # Database wipe and reset script
│   │   ├── db.js             # SQLite schema, migrations, query helpers
│   │   ├── routes/
│   │   │   ├── auth.js       # POST /api/auth/setup, /api/auth/unlock
│   │   │   ├── events.js     # CRUD /api/events, branding, logos, QR
│   │   │   ├── photos.js     # Upload, approve, delete, download, ZIP
│   │   │   └── drive.js      # Google Drive OAuth + incremental sync
│   │   ├── ws.js             # WebSocket handler, channels, broadcast
│   │   ├── thumbnail.js      # Sharp resize, EXIF strip
│   │   ├── drive.js          # Google Drive REST API integration
│   │   └── utils.js          # QR gen, SHA-256 hash, ZIP helpers
│   ├── data/                 # RUNTIME ONLY (gitignored)
│   │   ├── caps.db           # SQLite database
│   │   └── events/           # Photo storage per event
│   └── package.json
├── client/                   # Svelte 5 PWA
│   ├── src/
│   │   ├── App.svelte        # Unified responsive SPA interface
│   │   ├── lib/              # API client, offline queue, stores
│   │   ├── app.css           # Design tokens, loading skeletons, animations
│   │   └── main.js
│   ├── public/
│   │   ├── manifest.json     # PWA manifest
│   │   ├── icon.svg          # App icon
│   │   └── sw.js             # Service worker App Shell caching
│   └── package.json
├── caps.config.json          # Root admin configuration (PIN, host name, port)
├── launch-caps.bat           # 1-click Windows batch launcher
├── launch-caps.ps1           # PowerShell host launcher
└── docs/                     # Documentation & Architecture
```

## Configuration & Database Management

- **`caps.config.json`**: Root configuration file containing host name, admin PIN, and port. The server synchronizes this PIN with SQLite on startup.
- **`npm run db:reset` / `npm run clean`**: Clears all database records (`photos`, `guests`, `events`, `drive_sync_log`), deletes event files on disk, and re-seeds admin settings from `caps.config.json`.

## Database Schema

```sql
-- Host configuration (single row)
settings(id, host_name, pin_hash, session_token, google_client_id, google_client_secret,
         google_refresh_token, google_access_token, google_token_expiry, google_account_email, created_at)

-- Events
events(id, name, slug, date, cover_photo, logo, tagline, primary_color,
       moderation_enabled, guest_upload_limit, exif_strip,
       slideshow_interval, slideshow_transition, slideshow_show_qr, slideshow_show_author,
       status TEXT CHECK(status IN ('active','archived')), created_at)

-- Guests (per event, no account required)
guests(id, event_id, name, token, upload_count, created_at)

-- Photos
photos(id, event_id, guest_id, filename, hash,
       status TEXT CHECK(status IN ('pending','approved','rejected')),
       original_path, thumbnail_path, created_at)

-- Google Drive sync tracking
drive_sync_log(id, event_id, photo_id, drive_file_id, synced_at)
```

## API Conventions

- All API routes are under `/api/*`
- PIN-protected routes require `Authorization: Bearer <session-token>` header
- Guest-authenticated routes require `X-Guest-Token: <token>` header
- File uploads use `multipart/form-data`
- All responses are JSON with `{ success: true, ... }` or `{ success: false, error: "message" }`
- WebSocket messages are JSON: `{ type: "photo:approved", payload: { ... } }`

## Critical Business Rules

1. **Guest upload limit**: Default 20 per guest, configurable per event. Guests can delete their own photos to free slots.
2. **Soft delete**: Guest-deleted photos move to `data/events/:slug/deleted/` — files are NEVER truly deleted by guest action.
3. **Host delete**: Event or photo deletion by host requires PIN verification.
4. **Moderation**: When enabled, uploads start as `pending`. When disabled, uploads auto-set to `approved`.
5. **Duplicate detection**: SHA-256 hash of file content. Reject if same hash exists in the same event.
6. **EXIF stripping**: Configurable per event. When enabled, Strip EXIF from originals before storage. When disabled, keep EXIF data.
7. **Thumbnails**: Always generated at 300px wide via Sharp, regardless of EXIF setting.
8. **QR codes**: One per event, encodes `http://<LAN_IP>:1000/event/:slug` for 100% universal device compatibility.

## Design System

| Token | Value |
|---|---|
| Primary blue | #2563EB |
| Dark blue | #1D4ED8 |
| Light blue | #DBEAFE |
| Background | #FFFFFF |
| Surface | #FAFBFC |
| Text primary | #111827 |
| Text secondary | #6B7280 |
| Font | Inter (Google Fonts) |
| Border radius | 8px (cards), 12px (modals), 9999px (pills) |
| Spacing unit | 4px base |

**Design philosophy:** Minimal, Instagram-inspired. Photos are the hero. White backgrounds, blue accents, generous whitespace. Mobile-first responsive. No visual clutter.

## Implementation Order (Vertical Slices)

Slices must be completed **in order** — each depends on the previous:

| # | Slice | Priority | Status |
|---|---|---|---|
| 1 | Server Skeleton + SQLite + First Event | 🔴 Critical | ✅ Completed |
| 2 | QR Code + Guest Entry | 🔴 Critical | ✅ Completed |
| 3 | Photo Upload + Thumbnails | 🔴 Critical | ✅ Completed |
| 4 | Approval Queue + Live Gallery | 🔴 Critical | ✅ Completed |
| 5 | Guest Photo Management + Downloads | 🔴 Critical | ✅ Completed |
| 6 | Slideshow / TV Mode | 🟡 High | ✅ Completed |
| 7 | Event Lifecycle + Analytics | 🟡 High | ✅ Completed |
| 8 | Google Drive Sync | 🟡 High | ✅ Completed |
| 9 | PWA + Offline + Packaging | 🟢 Medium | ✅ Completed |
| 10 | Per-Event Branding + Polish | 🟢 Medium | ✅ Completed |

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for full details on each slice.

## Do's and Don'ts

### Do
- ✅ Keep the API surface RESTful and consistent
- ✅ Use SQLite transactions for multi-step operations
- ✅ Broadcast WebSocket events after any state change to photos
- ✅ Generate thumbnails synchronously during upload (Sharp is fast enough)
- ✅ Store photos on the filesystem, metadata in SQLite
- ✅ Test on real phones over WiFi — that's the actual usage
- ✅ Handle WebSocket reconnection with exponential backoff on the client

### Don't
- ❌ Don't add new npm dependencies without documenting why
- ❌ Don't store photos as BLOBs in SQLite
- ❌ Don't require guests to create accounts or log in
- ❌ Don't bypass PIN checks for any host-only action
- ❌ Don't break the vertical slice order — each depends on the last
- ❌ Don't add features beyond V1 scope (Memory Spaces, video, voice, physical Dotbooks, i18n — all V2)
- ❌ Don't swap the tech stack (Tauri/Rust migration is planned for V2)

## V2 Roadmap (Out of Scope — Do Not Build)

- Memory Spaces (personal albums)
- Video + voice message support
- Dotbooks (physical/digital print albums)
- Tauri + Rust backend migration
- Mac / Linux packaging
- Multi-language / i18n
- Storage warnings
- Larger text accessibility toggle
- Auto-update mechanism
- Guest Google Drive sync
