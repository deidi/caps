# Implementation Plan: Caps v2 Server-less (Approach A: Sonata Architecture)

Transform **Caps** into a **100% serverless, zero-backend static web application** modeled after **Sonata** ([github.com/jethfrane/Sonata](https://github.com/jethfrane/Sonata)).

Organized into **7 Vertical Slices**—each slice delivers a small, working, immediately testable increment.

---

## 🏛️ Vertical Slices Summary

| Slice | Title | Key Technologies | Testable Output |
| :--- | :--- | :--- | :--- |
| **Slice 1** | Client DB & Local Event Hub | Dexie.js, Svelte 5 | Setup Host, PIN lock, create/list events in browser |
| **Slice 2** | Browser Photo Engine | Canvas, exifr, crypto.subtle | Client-side resize, thumbnail gen, duplicate hash checks |
| **Slice 3** | Zero-Backend Real-Time P2P | Trystero, WebRTC | Multi-device connection, stream photos from phone to host |
| **Slice 4** | Live Moderation & Slideshow | Svelte 5, WebRTC | Approve/reject photos, TV projector mode sync |
| **Slice 5** | Sonata Google Drive Sync | GIS OAuth 2.0, Drive REST API | 1-click Google Drive backup folder & manifest sync |
| **Slice 6** | Client-Side ZIP Exporter | JSZip, FileSaver.js | Instant in-memory full archive `.zip` download |
| **Slice 7** | Static Deployment & PWA | Vercel, Service Worker, Vite | Production static SPA deployment & offline support |

---

## Slice Breakdown

### 🍰 Slice 1 — Client Database (Dexie.js) & Local Event Hub
- **Goal**: Host opens the static app, completes first-time setup, creates events, lists events, and manages settings. Everything is stored persistently in browser **IndexedDB (Dexie.js)** with zero Node.js server dependencies.
- **Files**:
  - `[MODIFY]` [`client/package.json`](file:///d:/Projects/caps/client/package.json) (add `dexie`, `qrcode`)
  - `[NEW]` [`client/src/lib/db.js`](file:///d:/Projects/caps/client/src/lib/db.js)
  - `[MODIFY]` [`client/src/lib/api.js`](file:///d:/Projects/caps/client/src/lib/api.js)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Start `npm run dev` → setup host PIN → create event → reload browser → event persists in IndexedDB.

### 🍰 Slice 2 — Browser Photo Engine (Canvas Resizing, Thumbnails, EXIF & Hashes)
- **Goal**: Client-side photo processing using HTML5 Canvas, Web Workers, and `exifr`. Handles downscaling to 2048px WebP/JPEG, 360px thumbnail generation, duplicate SHA-256 hash checking, and EXIF stripping.
- **Files**:
  - `[MODIFY]` [`client/package.json`](file:///d:/Projects/caps/client/package.json) (add `exifr`)
  - `[NEW]` [`client/src/lib/photo-engine.js`](file:///d:/Projects/caps/client/src/lib/photo-engine.js)
  - `[MODIFY]` [`client/src/lib/db.js`](file:///d:/Projects/caps/client/src/lib/db.js)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Upload 10MB photo → instant thumbnail generated in <200ms → re-upload same photo → duplicate warning shown → photos render via Object URLs.

### 🍰 Slice 3 — Zero-Backend Real-Time P2P Sharing (WebRTC Mesh / Trystero)
- **Goal**: Connect Host laptop and Guest mobile phones via WebRTC Data Channels using `trystero` with free public BitTorrent/Nostr signaling. Stream captured photos peer-to-peer into Host's moderation queue.
- **Files**:
  - `[MODIFY]` [`client/package.json`](file:///d:/Projects/caps/client/package.json) (add `trystero`)
  - `[NEW]` [`client/src/lib/p2p-mesh.js`](file:///d:/Projects/caps/client/src/lib/p2p-mesh.js)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Open Host tab in Chrome, open Guest tab in Firefox (or mobile phone) → join room → upload photo on Guest → photo arrives in Host moderation queue in real-time.

### 🍰 Slice 4 — Live Moderation, Live Gallery & TV Slideshow Synchronization
- **Goal**: Host moderates photos (Approve / Reject / Bulk); updates broadcast across WebRTC P2P to TV Slideshow (`/#/event/:slug/slideshow`) and Guest Live Wall.
- **Files**:
  - `[MODIFY]` [`client/src/lib/p2p-mesh.js`](file:///d:/Projects/caps/client/src/lib/p2p-mesh.js)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Approve photo on Host → TV Slideshow injects new slide immediately; Guest Live Wall updates without page refresh.

### 🍰 Slice 5 — Sonata-Style Direct Google Drive Cloud Sync (GIS + Drive v3)
- **Goal**: 1-click Google Drive connection in Host Dashboard. Syncs approved photos, thumbnails, and `event_manifest.json` directly from browser to the host's personal Google Drive folder (`/Caps Events/<Event Name>/`).
- **Files**:
  - `[NEW]` [`client/src/lib/gdrive.js`](file:///d:/Projects/caps/client/src/lib/gdrive.js)
  - `[MODIFY]` [`client/index.html`](file:///d:/Projects/caps/client/index.html) (add GIS client script)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Connect Google Drive via 1-click OAuth → click "Sync Approved Photos" → verify folder `/Caps Events/<Event Name>` created in Google Drive with uploaded photos.

### 🍰 Slice 6 — Client-Side Full Archive ZIP Exporter (JSZip)
- **Goal**: Generate full event archives (`.zip`) or download selected photos entirely in browser memory using `JSZip` + `file-saver`.
- **Files**:
  - `[MODIFY]` [`client/package.json`](file:///d:/Projects/caps/client/package.json) (add `jszip`, `file-saver`)
  - `[NEW]` [`client/src/lib/archive.js`](file:///d:/Projects/caps/client/src/lib/archive.js)
  - `[MODIFY]` [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte)
- **Immediate Test**: Click "Export Full Archive" → ZIP file downloads in <2s with `/originals`, `/thumbnails`, and `metadata.json`.

### 🍰 Slice 7 — Static SPA Build, PWA Offline Service Worker & Vercel Deployment
- **Goal**: Package Caps v2 for static hosting on Vercel and GitHub Pages with offline PWA capabilities.
- **Files**:
  - `[NEW]` [`vercel.json`](file:///d:/Projects/caps/vercel.json)
  - `[MODIFY]` [`client/public/sw.js`](file:///d:/Projects/caps/client/public/sw.js)
  - `[MODIFY]` [`package.json`](file:///d:/Projects/caps/package.json)
- **Immediate Test**: `npm run build` → `npm run preview` → verify static production build loads offline.
