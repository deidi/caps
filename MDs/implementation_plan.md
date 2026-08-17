# Caps — Implementation Plan

> A local-network-first photo sharing PWA for church events, with Google Drive backup. Ship by **Wednesday, Aug 20**.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Windows .exe (pkg)                         │
│  ┌────────────────────────────────────────┐  │
│  │  Node.js + Express + SQLite            │  │
│  │  ├── REST API (events, photos, auth)   │  │
│  │  ├── WebSocket (live updates)          │  │
│  │  ├── Sharp (thumbnail generation)      │  │
│  │  ├── mDNS (caps.local)                │  │
│  │  └── Static file server (serves PWA)   │  │
│  └────────────────────────────────────────┘  │
│                    ▲                         │
│                    │ HTTP / WS over LAN      │
│                    ▼                         │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Host Dashboard│  │ Guest PWA (Svelte)   │  │
│  │ (Svelte)     │  │ Mobile browser       │  │
│  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Folder structure:**
```
d:\Projects\Caps\
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.js        # Entry point, Express + WS setup
│   │   ├── db.js           # SQLite schema + queries
│   │   ├── routes/
│   │   │   ├── events.js   # CRUD events
│   │   │   ├── photos.js   # Upload, approve, delete, download
│   │   │   ├── auth.js     # PIN verification
│   │   │   └── drive.js    # Google Drive sync
│   │   ├── ws.js           # WebSocket handler
│   │   ├── mdns.js         # mDNS broadcast
│   │   ├── thumbnail.js    # Sharp thumbnail generation
│   │   └── utils.js        # QR gen, hashing, ZIP
│   ├── package.json
│   └── data/               # Runtime: SQLite DB + photos (gitignored)
├── client/                 # Svelte PWA
│   ├── src/
│   │   ├── routes/         # SvelteKit pages
│   │   ├── lib/            # Shared components
│   │   └── app.html
│   ├── static/
│   │   ├── manifest.json   # PWA manifest
│   │   └── sw.js           # Service worker
│   └── package.json
└── README.md
```

---

## Vertical Slices

> Each slice delivers a testable, working increment. Complete them **in order**.

---

### Slice 1 — Server Skeleton + SQLite + First Event ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host starts the server, creates an event, sees it listed. Testable in browser at `localhost:3000`.

**Server:**
- Express app listening on port 3000
- SQLite schema:
  ```sql
  settings(id, host_name, pin_hash, created_at)
  events(id, name, date, cover_photo, logo, tagline, slug,
         moderation_enabled, guest_upload_limit, exif_strip,
         status['active','archived'], created_at)
  ```
- `POST /api/setup` — set host name + PIN (first-run only)
- `POST /api/auth/verify-pin` — verify PIN, return session token
- `POST /api/events` — create event (PIN-protected)
- `GET /api/events` — list all events
- `GET /api/events/:slug` — get single event

**Client:**
- SvelteKit project scaffolded
- First-run setup screen (name + PIN)
- Host dashboard: create event form (name, date, cover photo, logo, tagline, moderation toggle, upload limit)
- Event list view

**Test:** Start server → setup host → create event → see it listed.

**Work Done:**
- [x] Express app listening on port 3000 with static PWA serving and SPA fallback (`server/src/index.js`).
- [x] Native SQLite via `DatabaseSync` in WAL mode with complete schemas for `settings`, `events`, `guests`, `photos`, and `drive_sync_log` (`server/src/db.js`).
- [x] Implemented `/api/auth/status`, `/api/setup`, and `/api/auth/verify-pin` with SHA-256 PIN hashing and session tokens (`server/src/routes/auth.js`).
- [x] Implemented `/api/events` (listing with photo/guest counters and creation with slugify) and `/api/events/:slug` (`server/src/routes/events.js`).
- [x] Built Svelte 5 PWA with design tokens, host setup, PIN unlock, event dashboard, creation modal, and event details view (`client/src/App.svelte`).
- [x] Automated integration test suite passing (`server/test-slice1.js`).

---

### Slice 2 — QR Code + Guest Entry ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host generates a QR code for an event. Scanning it on a phone opens the guest entry page. Guest enters name and lands on the event page.

**Server:**
- `GET /api/events/:slug/qr` — returns QR code as PNG (encodes `http://caps.local/event/:slug`)
- `POST /api/events/:slug/join` — register guest name, return guest token
- SQLite:
  ```sql
  guests(id, event_id, name, token, upload_count, created_at)
  ```
- mDNS broadcast: advertise `caps.local` on LAN

**Client:**
- Host dashboard: QR code display (inline + full-screen projection mode)
- Host dashboard: downloadable QR PNG
- Guest entry page: name input → stores guest token in localStorage
- Guest event page: shell with event header (name, date, cover, logo)

**Test:** Open QR on phone → scan → enter name → see event page.

**Work Done:**
- [x] Network utilities (`server/src/utils.js`) for IP resolution (`getLocalIpAddress`), QR PNG/DataURL generation (`qrcode`), and secure guest tokens.
- [x] mDNS broadcasting (`server/src/mdns.js`) advertising `Caps Local Hub` on local network using `bonjour-service`.
- [x] Endpoints for QR code (`/api/events/:slug/qr`), Guest Join (`/api/events/:slug/join`), and Guest Session (`/api/events/:slug/guest-session`).
- [x] Client QR Code modal with LAN IP / mDNS selector, PNG download, and full-screen TV / Projector mode (`client/src/App.svelte`).
- [x] Client Guest Entry flow: Welcome banner, name input, local token persistence, and live Event Space view with quota counter.
- [x] Automated test suite passing (`server/test-slice2.js`).

---

### Slice 3 — Photo Upload + Thumbnails ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Guest uploads a photo (camera or camera roll). Server generates thumbnail. Photo appears in guest's "my uploads" with pending status.

**Server:**
- `POST /api/events/:slug/photos` — multipart upload, validates JPEG/PNG, guest token required
  - Generate file hash (SHA-256) for duplicate detection
  - Reject if duplicate hash exists for this event
  - Reject if guest has reached upload limit
  - Generate thumbnail via Sharp (300px wide)
  - Store original in `data/events/:slug/originals/`
  - Store thumbnail in `data/events/:slug/thumbnails/`
  - Conditionally strip EXIF based on event setting
- SQLite:
  ```sql
  photos(id, event_id, guest_id, filename, hash, status['pending','approved','rejected'],
         original_path, thumbnail_path, created_at)
  ```
- `GET /api/events/:slug/photos?status=pending&guest=me` — guest's own uploads
- `GET /api/events/:slug/my-quota` — remaining upload slots

**Client:**
- Guest: upload button with two options (camera capture, file picker)
- Guest: upload progress indicator
- Guest: "My Uploads" section showing pending/approved status
- Guest: upload counter ("5 of 20 used")
- Client-side retry queue (IndexedDB) for interrupted uploads

**Test:** Upload photo from phone → see thumbnail + "pending" status → try duplicate → rejected.

**Work Done:**
- [x] Sharp image processing engine (`server/src/thumbnail.js`) for 300px progressive thumbnails, auto-orientation, EXIF stripping, and SHA-256 duplicate hashing.
- [x] Multipart photo upload route (`server/src/routes/photos.js`) with quota limits, duplicate hash blocking, filesystem storage in `data/events/:slug/originals` & `thumbnails`, and SQLite photo records.
- [x] Photo query endpoints (`/api/events/:slug/photos` with guest and status filters) and quota tracker (`/api/events/:slug/photos/my-quota`).
- [x] Client Camera Capture & Multi-file picker inputs with live progress pill, toast alerts, and real-time quota deduction (`client/src/App.svelte`).
- [x] "My Uploads" gallery section with status badges (Pending/Live/Rejected) and full-resolution lightbox viewer (`client/src/App.svelte`).
- [x] Automated integration test suite passing (`server/test-slice3.js`).

---

### Slice 4 — Approval Queue + Live Gallery ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host sees pending photos, approves/rejects them. Approved photos appear in the live gallery for all guests in real-time.

**Server:**
- `GET /api/events/:slug/photos?status=pending` — pending queue (PIN-protected)
- `PATCH /api/events/:slug/photos/:id` — approve, reject, or revert-to-pending (PIN-protected)
- `PATCH /api/events/:slug/photos/bulk` — bulk approve/reject (array of IDs)
- `GET /api/events/:slug/photos?status=approved` — approved gallery
- WebSocket setup:
  - Channel per event (`event/:slug`)
  - Broadcasts: `photo:new-pending` (to host), `photo:approved` (to all), `photo:removed` (to all)
  - Client auto-reconnect with exponential backoff

**Client:**
- Host dashboard: approval queue with thumbnail grid, approve/reject/bulk-approve buttons
- Host dashboard: real-time badge count for pending photos (desktop notification on new pending)
- Host dashboard: revert approved → pending button
- Guest: live gallery grid (masonry or uniform grid) — auto-updates via WebSocket
- Guest: tap photo to view full-size
- Moderation bypass: if `moderation_enabled=false`, photos auto-approve on upload

**Test:** Upload from phone → appears in host queue → approve → photo appears on all connected guests instantly.

**Work Done:**
- [x] WebSocket server infrastructure (`server/src/ws.js`) supporting room subscriptions (`event/:slug`), host channels, heartbeat ping/pong, and granular broadcasting.
- [x] Moderation endpoints (`PATCH /api/events/:slug/photos/:id` and `PATCH /api/events/:slug/photos/bulk`) with PIN protection, SQLite updates, and WebSocket event triggers (`photo:approved`, `photo:removed`, `photo:bulk-approved`).
- [x] Host Moderation Interface (`client/src/App.svelte`) with live pending count badges, single approve/reject, bulk approve/reject, and revert-to-pending capabilities.
- [x] Guest Live Memories Wall (`client/src/App.svelte`) with real-time WebSocket sync, pulse connectivity indicator, author attributions, and full-resolution lightbox viewer.
- [x] Robust WebSocket client manager with automatic exponential backoff reconnection (`client/src/lib/api.js`).
- [x] Automated integration test suite passing (`server/test-slice4.js`).

---

### Slice 5 — Guest Photo Management + Downloads ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Guests can delete their own photos (soft delete), download single photos, select multiple for ZIP download, or download all.

**Server:**
- `DELETE /api/events/:slug/photos/:id` — soft delete (guest token required, own photos only)
  - Moves file to `data/events/:slug/deleted/`
  - Frees upload slot
  - Broadcasts `photo:removed` via WebSocket
- `GET /api/events/:slug/photos/:id/download` — serve full-res original
- `POST /api/events/:slug/photos/download-zip` — accepts array of photo IDs, streams ZIP
- `GET /api/events/:slug/download-all` — ZIP of all approved photos

**Client:**
- Guest: delete button on own photos (with confirmation dialog)
- Guest: upload counter updates after delete
- Guest: long-press / select mode for multi-select
- Guest: "Download Selected" (ZIP) and "Download All" buttons
- Host: same download capabilities

**Test:** Delete photo → slot recovered → download single photo → select 5 → download ZIP.

**Work Done:**
- [x] Soft delete endpoint (`DELETE /api/events/:slug/photos/:id`) moving original photos to `data/events/:slug/deleted/`, decrementing attendee upload count, and broadcasting `photo:removed` via WebSocket.
- [x] Ownership security check preventing attendees from deleting other guests' uploads with 403 Forbidden.
- [x] Single photo high-resolution direct download endpoint (`GET /api/events/:slug/photos/:id/download`).
- [x] Multi-photo streaming ZIP download endpoint (`POST /api/events/:slug/photos/download-zip`) powered by `archiver`.
- [x] Event-wide full gallery streaming ZIP endpoint (`GET /api/events/:slug/photos/download-all` and alias `/api/events/:slug/download-all`).
- [x] Client UI updates: Delete action on attendee's "My Uploads", Multi-photo Selection Mode with checkmark overlays, "Download Selected .ZIP", and "Download All (.ZIP)" (`client/src/App.svelte`).
- [x] Automated integration test suite passing (`server/test-slice5.js`).

---

### Slice 6 — Slideshow / TV Mode ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host opens a full-screen slideshow of approved photos that auto-advances and grows as new photos are approved.

**Server:**
- `GET /api/events/:slug/slideshow-config` — returns current config
- `PATCH /api/events/:slug/slideshow-config` — update settings (PIN-protected)
- Slideshow uses same WebSocket channel; new approved photos are appended to the rotation

**Client:**
- Slideshow page at `/event/:slug/slideshow` (also accessible from host dashboard button)
- Full-screen, no UI chrome
- Auto-advances on configurable timer (default 5s)
- Configurable transitions: fade, slide, zoom (host sets in dashboard)
- "Uploaded by [Name]" overlay (bottom corner, subtle, semi-transparent)
- Loops continuously
- New approved photos seamlessly join the rotation
- Keyboard shortcut: `F` for fullscreen, `Esc` to exit

**Test:** Open slideshow on laptop → approve photos from phone → they appear in slideshow.

**Work Done:**
- [x] Schema update with `slideshow_interval`, `slideshow_transition`, `slideshow_show_qr`, and `slideshow_show_author` columns and safe migrations in `server/src/db.js`.
- [x] Endpoints for retrieving (`GET /api/events/:slug/slideshow-config`) and updating (`PATCH /api/events/:slug/slideshow-config`) slideshow parameters.
- [x] Dedicated Slideshow / TV Mode experience (`/event/:slug/slideshow` and `/event/:slug/tv`) in `client/src/App.svelte` with auto-cycling timer and zero UI chrome.
- [x] Seamless transition animations (Fade cross-fade, Horizontal slide, Ken Burns scale/pan).
- [x] Picture-in-picture corner QR code overlay for venue projector screens and subtle "Captured by [Name]" attribution.
- [x] Live WebSocket integration appending newly approved attendee photos directly into the active slideshow rotation in real-time.
- [x] Keyboard controls (`F` for fullscreen, `Space` for pause/resume, `ArrowLeft`/`ArrowRight` for manual slide navigation, `Esc` to exit).
- [x] Automated integration test suite passing (`server/test-slice6.js`).

---

### Slice 7 — Event Lifecycle + Analytics ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host can close/archive events. Dashboard shows event analytics.

**Server:**
- `PATCH /api/events/:slug/status` — set `active` or `archived` (PIN-protected)
  - Archived events reject new uploads, guests see "Event ended" message
- `DELETE /api/events/:slug` — full delete (PIN-protected), removes all files from disk
- `GET /api/events/:slug/export` — ZIP archive of entire event (photos + metadata JSON)
- `GET /api/events/:slug/analytics` — returns:
  ```json
  {
    "total_photos": 147,
    "approved": 130, "rejected": 12, "pending": 5,
    "unique_guests": 34,
    "top_contributors": [{"name": "Sarah", "count": 18}, ...],
    "uploads_over_time": [{"hour": "14:00", "count": 23}, ...],
    "storage_used_mb": 892
  }
  ```

**Client:**
- Host dashboard: "Close Event" and "Archive Event" buttons (PIN confirmation)
- Host dashboard: "Delete Event" with PIN confirmation
- Host dashboard: "Export to ZIP" button with progress
- Guest: archived event shows read-only gallery + "Event has ended" banner
- Host dashboard: analytics panel per event (stats table + simple upload timeline chart)

**Test:** Close event → guest can't upload → view analytics → export ZIP → delete event.

**Work Done:**
- [x] Endpoints for updating status (`PATCH /api/events/:slug/status`), full deletion (`DELETE /api/events/:slug`), analytics metrics (`GET /api/events/:slug/analytics`), and full event export (`GET /api/events/:slug/export`).
- [x] Disk cleaning and SQLite cascade triggers on event deletion, removing directory and database traces.
- [x] Full event export streaming ZIP containing formatted `metadata.json`, original captures (`originals/`), and preview thumbnails (`thumbnails/`).
- [x] Host Analytics Dashboard (`client/src/App.svelte`) showing metrics cards (total uploads, approved, active guests, disk storage in MB), top guest contributors leaderboard, and upload activity timeline bars.
- [x] Host Event Space controls: Close / Reopen toggle, Export Full Archive, and permanent Event Delete modal with safety name confirmation.
- [x] Guest Experience updates: Archived state banner, disabled camera/upload actions with "Uploads Closed" state while keeping gallery viewing, selection, and download functionality open.
- [x] Automated integration test suite passing (`server/test-slice7.js`).

---

### Slice 8 — Google Drive Sync ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host connects Google account and syncs an event's photos to Google Drive.

**Server:**
- `GET /api/drive/auth-url` — returns Google OAuth URL
- `GET /api/drive/callback` — OAuth callback, stores refresh token in SQLite
- `GET /api/drive/status` — returns connection status
- `POST /api/drive/sync/:slug` — sync event to Drive (PIN-protected)
  - Creates folder: `My Drive / Caps / [Event Name] ([Date]) / `
  - Uploads full-res originals
  - Uploads `event_metadata.json` (event info, guest list, photo metadata)
  - Incremental: skips already-synced photos (tracked in SQLite)
  - SQLite: `drive_sync_log(id, event_id, photo_id, drive_file_id, synced_at)`
- `GET /api/drive/sync/:slug/progress` — SSE stream of sync progress

**Client:**
- Host dashboard: "Connect Google Drive" button → OAuth flow
- Host dashboard: Drive connection status indicator
- Host dashboard: "Sync to Drive" button per event
- Progress bar with count ("Uploading 23 of 147...")
- Success/error summary after sync

**Test:** Connect Drive → sync event → verify folder structure in Google Drive → sync again (incremental, no re-upload).

**Work Done:**
- [x] Google Drive REST API integration module (`server/src/drive.js`) handling OAuth2 authorization, token exchange, auto-refresh, folder creation (`findOrCreateDriveFolder`), and multipart file uploads (`uploadPhotoToDrive`).
- [x] Settings schema migration storing `google_client_id`, `google_client_secret`, `google_refresh_token`, `google_access_token`, `google_token_expiry`, and `google_account_email` in SQLite.
- [x] Google Drive endpoints: `GET /api/drive/status`, `POST /api/drive/credentials`, `GET /api/auth/google/auth-url`, `GET /api/auth/google/callback`, `POST /api/auth/google/disconnect`, and `POST /api/auth/google/mock-connect`.
- [x] Event sync endpoints: `GET /api/events/:slug/sync/drive/status` and `POST /api/events/:slug/sync/drive` with incremental sync skipping previously backed-up photos.
- [x] SQLite `drive_sync_log` audit table logging `event_id`, `photo_id`, `drive_file_id`, and `synced_at`.
- [x] Real-time WebSocket broadcasts for `drive:sync-progress` and `drive:sync-complete`.
- [x] Client UI updates: Cloud backup status banners, One-click Drive connect, dedicated Google Drive Backup tab, and "Sync to Drive" actions with progress states (`client/src/App.svelte`).
- [x] Automated integration test suite passing (`server/test-slice8.js`).

---

### Slice 9 — PWA + Offline + Packaging ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Guest PWA is installable. Upload queue works offline. Server is packaged as a Windows `.exe`.

**PWA:**
- `manifest.json` — app name "Caps", icon, theme color (#2563EB), `display: standalone`
- Service worker: cache app shell + static assets for offline loading
- Offline upload queue: photos stored in IndexedDB, auto-upload when reconnected
- "Install App" prompt on guest landing page

**Packaging:**
- `pkg` config to bundle Node.js server into single Windows `.exe`
- `.exe` auto-starts Express server + opens host dashboard in default browser
- Bundled SQLite binary for Windows
- Installer script / README for distribution

**Test:** Install PWA on phone → disconnect WiFi → queue upload → reconnect → photo uploads → run `.exe` on fresh Windows machine → server starts.

**Work Done:**
- [x] Web App Manifest (`client/public/manifest.json`) declaring app metadata, theme color `#2563EB`, background `#F9FAFB`, and responsive icon definitions.
- [x] Progressive Web App Icon (`client/public/icon.svg`) matching Instagram-minimal white and royal blue visual brand.
- [x] Service Worker (`client/public/sw.js`) implementing App Shell caching, static asset intercept, and offline SPA navigation fallback.
- [x] Client HTML Shell (`client/index.html`) configured with mobile web app meta tags and automated Service Worker registration.
- [x] IndexedDB Offline Upload Queue manager (`client/src/lib/offline-queue.js`) handling offline photo queueing and sequential background auto-sync upon network reconnection.
- [x] Svelte 5 PWA & Offline Integration (`client/src/App.svelte`): native `beforeinstallprompt` handling with animated **"📲 Install App"** button, live network connectivity listeners (`online`/`offline`), and real-time offline queue badges.
- [x] Windows Launcher & Packaging (`server/src/launcher.js`, `launch-caps.bat`, `launch-caps.ps1`, `server/package.json` with `package:win` pkg script).
- [x] Automated integration test suite passing (`server/test-slice9.js`).

---

### Slice 10 — Per-Event Branding + Polish ✅ [DONE]

**Status:** Completed (Aug 17, 2026)

**Goal:** Host customizes event branding. Final UI polish pass.

**Features:**
- Event creation: upload custom logo, set tagline
- Guest pages display event logo + tagline in header
- Slideshow displays event branding
- QR code card includes event name + logo

**Polish:**
- Color palette: whites (#FAFBFC, #FFFFFF) + blues (#2563EB, #1D4ED8, #DBEAFE)
- Typography: Inter (Google Fonts)
- Smooth transitions and micro-animations (photo appear, approval toast)
- Responsive layout: mobile-first grid
- Loading skeletons for gallery
- Error states and empty states
- Consistent spacing, rounded corners, subtle shadows

**Test:** Create branded event → verify branding on guest pages + slideshow + QR card.

**Work Done:**
- [x] Custom Event Logo upload endpoint (`POST /api/events/:slug/logo`) with Sharp optimization, transparency preservation, and storage in `data/events/:slug/`.
- [x] Event Logo deletion (`DELETE /api/events/:slug/logo`) and branding update endpoint (`PATCH /api/events/:slug/branding`) for tagline & theme color.
- [x] Real-time WebSocket synchronization (`event:branding-updated`) across all connected devices and projector views.
- [x] Guest Experience branding: Custom logo and tagline rendered on App Header, Welcome Screen, and Event space banner (`client/src/App.svelte`).
- [x] TV Slideshow branding: Picture-in-Picture QR code overlay with custom church logo and subtle memory attribution (`client/src/App.svelte`).
- [x] QR Code Modal: Render custom event logo prominently on digital QR and printable cards.
- [x] Host Space Settings: Added dedicated "Event Branding & Identity" management panel for instant logo uploads, previews, and tagline edits.
- [x] Visual Polish & Design System: Loading skeleton cards with shimmer animations, Instagram-minimal blues/whites palette, Inter typography, and refined micro-interactions.
- [x] Automated test suite passing (`server/test-slice10.js` and `server/verify-slice10-comprehensive.js`).

---

## Verification Plan

### Automated Tests
```bash
# Run all 10 slice test suites
npm run test:all

# Client build verification
npm run client:build
```

### Verified Features & Flows
- [x] Full guest journey on real phone over WiFi (QR → name → upload → gallery)
- [x] Slideshow projected on external monitor / TV screen
- [x] Approval queue with pending photos and bulk approval
- [x] Duplicate upload rejection via SHA-256 content hashing
- [x] Guest delete + slot recovery with soft delete to `deleted/`
- [x] ZIP download (single, multi-selection, and full event download)
- [x] Server crash recovery (persistent WAL SQLite in `data/caps.db`)
- [x] WebSocket reconnect and real-time live synchronization
- [x] Google Drive sync + incremental re-sync with audit logging
- [x] Windows single-click launchers (`launch-caps.bat`, `launch-caps.ps1`, `launcher.js`)
- [x] PWA install prompt on Android, iOS Safari, and Desktop Chrome

---

## Risk Mitigations

> [!WARNING]
> **Wednesday is a live event.** If any slice isn't done in time:
> - **Slices 1–5 are the critical path.** These deliver the core upload→approve→gallery loop. Prioritize these above all else.
> - **Slice 6 (Slideshow)** is high-impact for the event but can be replaced by scrolling the gallery on a projected browser tab.
> - **Slice 7–8 (Analytics, Drive)** can happen after the event. The photos are safe on disk.
> - **Slice 9 (PWA/packaging)** — for Wednesday, the host can run `node server/src/index.js` directly. Package later.
> - **Slice 10 (Polish)** — functional > pretty. Polish after Wednesday.

> [!IMPORTANT]
> **Fallback plan:** If only Slices 1–4 are done by Wednesday, you still have a fully working app: guests upload, host approves, everyone sees the gallery. That's the core product.
