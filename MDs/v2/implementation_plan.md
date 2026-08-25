# 📸 Caps v2 — Server-less Implementation Plan (Sonata Architecture)

> A 100% serverless, client-first event photo hub running entirely in the browser with WebRTC P2P sharing, IndexedDB local storage, client-side photo processing, and Sonata-style Google Drive direct sync.

---

## 🏛️ Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  Static Web App (Vercel / GitHub Pages / Offline PWA)                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Caps Client-Side Engine (No Backend Server Required)            │  │
│  │  ├── IndexedDB / Dexie.js (Events, Photos, Guests, Settings)     │  │
│  │  ├── Photo Engine (OffscreenCanvas, Web Workers, exifr, SHA-256) │  │
│  │  ├── WebRTC Mesh / Trystero (P2P real-time photo & state sync)   │  │
│  │  ├── Google Drive Sync (Client GIS OAuth 2.0 + Drive REST API v3)│  │
│  │  └── Archive Exporter (JSZip + FileSaver in-memory bundler)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                  ▲                                     │
│                                  │ WebRTC Data Channels (LAN/Internet) │
│                                  ▼                                     │
│  ┌─────────────────────────────┐        ┌───────────────────────────┐  │
│  │ Host Dashboard & Slideshow  │◄───────┤ Guest Mobile PWA          │  │
│  │ (IndexedDB + Drive Sync)    │        │ (Camera / Live Gallery)   │  │
│  └─────────────────────────────┘        └───────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**Project Structure (v2 Branch):**
```
d:\Projects\caps\
├── client/                     # Pure Static Svelte SPA
│   ├── public/
│   │   ├── manifest.json       # PWA manifest
│   │   ├── sw.js               # Service Worker for offline caching
│   │   └── icon.svg            # App icons
│   ├── src/
│   │   ├── lib/
│   │   │   ├── db.js           # IndexedDB schema & queries (Dexie.js)
│   │   │   ├── photo-engine.js # Canvas resize, thumbnails, EXIF & SHA-256
│   │   │   ├── p2p-mesh.js     # WebRTC P2P data channels (Trystero)
│   │   │   ├── gdrive.js       # Sonata Google Drive OAuth & REST client
│   │   │   ├── archive.js      # JSZip client-side archive exporter
│   │   │   ├── offline-queue.js# Offline upload queue & sync manager
│   │   │   └── api.js          # Unified local engine API interface
│   │   ├── App.svelte          # Svelte 5 Host, Guest, and Slideshow views
│   │   ├── app.css             # Design tokens & styling
│   │   └── main.js             # Vite entry point
│   ├── index.html              # HTML shell & GIS script tag
│   ├── package.json            # Client dependencies
│   └── vite.config.js          # Vite build configuration
├── vercel.json                 # Vercel SPA routing configuration
├── MDs/
│   └── v2/
│       ├── implementation_plan.md # This document
│       └── walkthrough-slice*.md  # Verification logs for each slice
└── package.json                # Root build scripts
```

---

## 🍰 Vertical Slices

> Each slice delivers a small, working, testable increment. Complete them **in order**.

---

### Slice 1 — Client Database (Dexie.js) & Local Event Hub

**Goal:** Host opens the static app, completes first-time setup, creates events, lists events, and manages settings. Everything is stored persistently in browser **IndexedDB (Dexie.js)** with zero Node.js server dependencies.

**Dependencies to add:**
- `dexie` (Fast, ergonomic IndexedDB wrapper with reactive queries)
- `qrcode` (Browser-native QR code generator)

**Deliverables:**
- **Database Schema (`client/src/lib/db.js`)**:
  ```javascript
  settings: 'id, host_name, pin_hash, gdrive_client_id, theme'
  events: 'id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, created_at'
  guests: 'id, event_slug, name, token, upload_count, created_at'
  photos: 'id, event_slug, guest_id, guest_name, hash, status, created_at'
  sync_logs: 'id, event_slug, photo_id, status, error, timestamp'
  ```
- **Unified Engine API (`client/src/lib/api.js`)**:
  - Local asynchronous methods: `getAuthStatus`, `setupHost`, `verifyPin`, `getEvents`, `getEvent(slug)`, `createEvent(data)`, `deleteEvent(slug)`, `updateEventStatus(slug, status)`.
- **UI Updates (`client/src/App.svelte`)**:
  - First-time Host Setup (Name + 4-digit PIN stored in IndexedDB with SHA-256).
  - Host PIN Unlock modal.
  - Host Event Dashboard: "+ Create New Event" modal, Event Card listing with photo/guest counters, and Event Details shell.

**Manual Verification Test:**
1. Start dev server: `cd client && npm run dev`.
2. Open `http://localhost:5173/`.
3. Complete First-Time Setup with Host Name "Media Team" and PIN "1234".
4. Create an event "Sunday Worship".
5. Refresh the browser; verify host unlock PIN works and the event is displayed from IndexedDB.

---

### Slice 2 — Browser Photo Engine (Canvas Resizing, Thumbnails, EXIF & Hashes)

**Goal:** Host or Guest selects photos from their device camera/gallery. The client-side photo engine parses orientation & EXIF with `exifr`, generates a duplicate-checking SHA-256 hash, creates high-res (2048px) and thumbnail (360px) Blobs via HTML5 Canvas, and stores them in IndexedDB.

**Dependencies to add:**
- `exifr` (Fast client-side EXIF parser and orientation auto-corrector)

**Deliverables:**
- **Photo Processing Engine (`client/src/lib/photo-engine.js`)**:
  - `computePhotoHash(blob)`: SHA-256 digest using `crypto.subtle`.
  - `processPhotoClient(file, options)`: Downscales to 2048px WebP/JPEG, creates 360px thumbnail Blob, extracts orientation, strips EXIF if configured.
- **IndexedDB Photo Storage (`client/src/lib/db.js`)**:
  - Store original and thumbnail image Blobs.
  - Duplicate detection: check if `hash` already exists for the event.
  - Enforce guest upload limits.
- **UI Updates (`client/src/App.svelte`)**:
  - Local photo uploader in Host/Guest view.
  - Render photos using Object URLs (`URL.createObjectURL(blob)`).
  - Fullscreen photo lightbox preview.
  - Instant duplicate rejection notice if the same photo is uploaded twice.

**Manual Verification Test:**
1. Open an event page.
2. Select a 10MB JPEG image.
3. Verify client-side thumbnail generation completes in <200ms.
4. Attempt to upload the exact same image again; verify duplicate warning is shown.
5. Inspect IndexedDB in DevTools; verify original and thumbnail Blobs are stored.

---

### Slice 3 — Zero-Backend Real-Time P2P Sharing (WebRTC Mesh / Trystero)

**Goal:** Multi-device synchronization without any backend server! Host opens an event; Guest opens the event URL or scans the QR code on a mobile phone; Guest joins the event and streams photo Blobs over a WebRTC Data Channel directly into the Host's browser moderation queue.

**Dependencies to add:**
- `trystero` (Zero-config WebRTC peer-to-peer data channels with public BitTorrent/Nostr/MQTT tracker signaling)

**Deliverables:**
- **P2P Mesh Module (`client/src/lib/p2p-mesh.js`)**:
  - Room identifier: `caps-event-<slug>`.
  - Peer actions:
    - `SEND_GUEST_JOIN`: Guest registers name; Host creates guest record in IndexedDB and responds with approval.
    - `STREAM_PHOTO`: Binary chunking protocol to transfer photo Blobs + metadata from Guest to Host with progress tracking.
    - `BROADCAST_PHOTO_STATUS`: Host notifies all peers when a photo is approved or rejected.
- **UI Updates (`client/src/App.svelte`)**:
  - P2P Connection Status Indicator (Connected / Connecting / Peers Count).
  - Dynamic QR code modal for guests to join the P2P room (`/#/event/<slug>`).
  - Guest photo upload progress bar showing real-time P2P chunk transmission.
  - Host Moderation Queue receives incoming photo instantly.

**Manual Verification Test:**
1. Open Host dashboard in Chrome (`http://localhost:5173/#/`).
2. Open Guest view in Firefox or on a mobile phone (`http://localhost:5173/#/event/sunday-worship`).
3. Observe P2P connection established (peer count increments to 2).
4. Upload a photo on the Guest tab; verify photo streams across P2P and immediately appears in Host's Moderation Queue.

---

### Slice 4 — Live Moderation, Live Gallery & TV Slideshow Synchronization

**Goal:** Host moderates photos (Approve / Reject / Bulk Actions); state changes instantly propagate over the WebRTC P2P swarm to all connected guests' Live Gallery and to TV Slideshow screens without page reloads.

**Deliverables:**
- **Moderation Actions (`client/src/lib/api.js` & `p2p-mesh.js`)**:
  - `patchPhotoStatus(slug, photoId, 'approved' | 'rejected')`.
  - `bulkPatchPhotoStatus(slug, photoIds, status)`.
  - P2P broadcast of approved photo Blobs to secondary screens.
- **TV Slideshow View (`/#/event/:slug/slideshow`)**:
  - Fullscreen stage presentation mode.
  - Real-time slide injection when a photo is approved.
  - Configurable interval (3s–15s), pause/resume on Space, full-screen on F, QR code overlay toggle.
- **Guest Live Wall (`client/src/App.svelte`)**:
  - Real-time responsive grid showing all approved photos.
  - Tap-to-expand lightbox with high-res zoom.

**Manual Verification Test:**
1. Open 3 tabs: (A) Host Moderation, (B) Guest Live Wall, (C) TV Slideshow (`/#/event/sunday-worship/slideshow`).
2. Host clicks "Approve" on a pending photo in Tab A.
3. Observe Tab B (Live Wall) instantly display the new photo.
4. Observe Tab C (Slideshow) smoothly transition and include the new photo in rotation.

---

### Slice 5 — Sonata-Style Direct Google Drive Cloud Sync (GIS + Drive v3)

**Goal:** Provide 1-click Google Drive connection in Host Dashboard (matching Sonata's exact architecture). The Host browser creates a folder `/Caps Events/<Event Name>/` and syncs approved photos, thumbnails, and `event_manifest.json` directly to the host's Google Drive.

**Deliverables:**
- **Google Identity Services & Drive REST API (`client/src/lib/gdrive.js`)**:
  - Client-side OAuth 2.0 token client using Google Identity Services (GIS).
  - Scope: `https://www.googleapis.com/auth/drive.file` (restricted scope — Caps only accesses files it creates).
  - Automatic folder creation: `Caps Events/<Event Name>/originals` and `/thumbnails`.
  - Multipart upload of photo Blobs with resume and retry logic.
  - Sync `event_manifest.json` for seamless backup and cross-device restore.
- **Host Dashboard UI (`client/src/App.svelte`)**:
  - "☁️ Connect Google Drive" button with user email indicator.
  - "Sync to Google Drive" button with real-time sync progress bar.
  - Cloud backup status badges on photo cards.

**Manual Verification Test:**
1. Host opens Event Settings and clicks "Connect Google Drive".
2. Complete the 1-click Google OAuth popup.
3. Click "Sync Approved Photos".
4. Open Google Drive in another tab; verify the `/Caps Events/Sunday Worship/` folder exists with uploaded photos and `event_manifest.json`.

---

### Slice 6 — Client-Side Full Archive ZIP Exporter (JSZip)

**Goal:** Host downloads full event archives or selected photos as a single `.zip` file generated entirely in the browser using `JSZip` and `file-saver`, with zero server disk I/O.

**Dependencies to add:**
- `jszip` (Browser-native ZIP archive builder)
- `file-saver` (Client-side file saving utility)

**Deliverables:**
- **Archive Generator (`client/src/lib/archive.js`)**:
  - `exportFullEventArchive(eventSlug)`: Assembles all original Blobs, thumbnail Blobs, and a formatted `metadata.json` (event name, date, guest names, photo timestamps, hashes).
  - `exportSelectedPhotosZip(eventSlug, photoIds)`: Bundles selected photos.
- **Host Dashboard UI (`client/src/App.svelte`)**:
  - "📦 Export Full Archive (.zip)" button with instant download.
  - Multi-select photo checkboxes + "Download Selected (.zip)".

**Manual Verification Test:**
1. Host clicks "Export Full Archive".
2. Verify browser immediately triggers download of `caps-sunday-worship-archive.zip` (<2 seconds).
3. Open the downloaded ZIP; verify it contains `/originals`, `/thumbnails`, and `metadata.json`.

---

### Slice 7 — Static SPA Build, PWA Offline Service Worker & Vercel Deployment

**Goal:** Finalize the application for production deployment on **Vercel** and **GitHub Pages** with full offline PWA capabilities (Service Worker).

**Deliverables:**
- **Vercel Configuration (`vercel.json`)**:
  - Single-page application rewrites and asset caching headers.
- **Service Worker & PWA (`client/public/sw.js` & `manifest.json`)**:
  - Cache core app shell, fonts, and assets for offline execution.
- **Root Scripts & Build (`package.json`)**:
  - Simplified scripts: `npm run dev`, `npm run build`, `npm run preview`.
- **Documentation**:
  - Updated `README.md` with Vercel 1-click deploy badge and local dev instructions.

**Manual Verification Test:**
1. Run `npm run build` from root; verify clean production build in `client/dist/`.
2. Run `npm run preview` to test static bundle locally.
3. Open DevTools, toggle "Offline" mode; verify app shell loads and existing IndexedDB events remain accessible.

---

## 📊 Summary of Slices & Deliverables

| Slice | Title | Key Technologies | User-Testable Output |
| :--- | :--- | :--- | :--- |
| **Slice 1** | Client DB & Local Event Hub | Dexie.js, Svelte 5 | Setup Host, PIN lock, create/list events in browser |
| **Slice 2** | Browser Photo Engine | Canvas, exifr, crypto.subtle | Client-side resize, thumbnail gen, duplicate hash checks |
| **Slice 3** | Zero-Backend Real-Time P2P | Trystero, WebRTC | Multi-device connection, stream photos from phone to host |
| **Slice 4** | Live Moderation & Slideshow | Svelte 5, WebRTC | Approve/reject photos, TV projector mode sync |
| **Slice 5** | Sonata Google Drive Sync | GIS OAuth 2.0, Drive REST API | 1-click Google Drive backup folder & manifest sync |
| **Slice 6** | Client-Side ZIP Exporter | JSZip, FileSaver.js | Instant in-memory full archive `.zip` download |
| **Slice 7** | Static Deployment & PWA | Vercel, Service Worker, Vite | Production static SPA deployment & offline support |
