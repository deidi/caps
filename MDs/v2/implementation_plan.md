# 📸 Caps v2 — Server-less Event Photo Hub (Approach A: Sonata Architecture)

## Overview & Vision

**Caps v2** transforms Caps into a **100% serverless, zero-backend static web application** modeled after **Sonata** ([github.com/jethfrane/Sonata](https://github.com/jethfrane/Sonata)).

In **Version 1 (`v1.0.0`)**, Caps runs as a local-first Node.js + Express + SQLite monolith on a dedicated host laptop on the local Wi-Fi.
In **Version 2 (`v2`)**, Caps runs **entirely in the browser**:
- **Zero Backend Servers**: Hosted as a static Single Page Application (SPA) on **Vercel** and **GitHub Pages**.
- **Client-Side Database**: **IndexedDB (Dexie.js)** stores events, guests, photos (as Blobs), and settings directly in the browser.
- **Client-Side Image Pipeline**: **OffscreenCanvas / Web Workers** and **`exifr`** handle resizing (max 2048px), thumbnail generation (360px), duplicate SHA-256 hashing, and EXIF stripping.
- **Zero-Backend Real-Time Mesh**: **WebRTC Data Channels (`trystero`)** stream photos peer-to-peer from guest mobile phones directly into the Host's browser, TV Slideshow, and Live Gallery using free public BitTorrent/Nostr signaling.
- **Sonata-Style Google Drive Sync**: Direct client-to-Google-Drive synchronization using **Google Identity Services (GIS)** with the restricted `drive.file` scope. Automatically creates `/Caps Events/<Event Name>` in the host's Google Drive.
- **In-Memory Archive Exporter**: Client-side **`JSZip` + `FileSaver.js`** packages full event archives (`.zip`) in seconds without server disk I/O.

---

## 🔀 Branch & Versioning Strategy

- **`v1.0.0` Tag / `main` Branch**: Contains the complete, frozen Version 1 local Node.js + SQLite application. You can switch back or deploy offline anytime:
  ```bash
  git checkout main   # or git checkout v1.0.0
  ```
- **`v2` Branch**: Dedicated development branch for the server-less static web app.
  ```bash
  git checkout v2
  ```

---

## 🛠️ Step-by-Step Implementation Roadmap (Approach A)

### Phase 1: Core Client Dependencies & Database Schema
1. Install client libraries in `client/package.json`:
   - `dexie`: IndexedDB wrapper for relational queries & live queries.
   - `trystero`: Zero-backend WebRTC data channel mesh.
   - `exifr`: Fast client-side EXIF parser and orientation corrector.
   - `jszip` & `file-saver`: Client-side ZIP generation.
   - `qrcode`: Browser-native QR code generator.
2. Implement [`client/src/lib/db.js`](file:///d:/Projects/caps/client/src/lib/db.js):
   - Tables: `events`, `photos`, `guests`, `settings`, `sync_logs`.
   - Indexed queries by `event_slug`, `status` (`pending`, `approved`, `rejected`), and `hash`.

### Phase 2: Client-Side Image Processing Engine
1. Implement [`client/src/lib/photo-engine.js`](file:///d:/Projects/caps/client/src/lib/photo-engine.js):
   - `computePhotoHash(buffer)`: SHA-256 duplicate detection.
   - `processPhotoClient(file, options)`: OffscreenCanvas downscaling to 2048px high-res WebP/JPEG + 360px thumbnail Blob.
   - `stripExifData(file)`: Privacy strip for location/camera metadata.

### Phase 3: WebRTC P2P Real-Time Communication
1. Implement [`client/src/lib/p2p-mesh.js`](file:///d:/Projects/caps/client/src/lib/p2p-mesh.js):
   - Host peer: Creates room `caps-<slug>`, authorizes guests, receives photo chunks, broadcasts approved photos to TV slideshow and guest live galleries.
   - Guest peer: Joins room `caps-<slug>`, sends guest identity, streams photo Blobs to host with progress callbacks.
   - TV Slideshow peer: Receives real-time broadcast of approved photos.

### Phase 4: Google Drive Direct Cloud Sync (Sonata Model)
1. Implement [`client/src/lib/gdrive.js`](file:///d:/Projects/caps/client/src/lib/gdrive.js):
   - 1-click Google OAuth 2.0 GIS popup with `drive.file` scope.
   - Folder creation: `Caps Events/<Event Name>/originals` and `.../thumbnails`.
   - Background non-blocking photo upload queue and `event_manifest.json` backup.

### Phase 5: Client-Side ZIP Archive Generation
1. Implement [`client/src/lib/archive.js`](file:///d:/Projects/caps/client/src/lib/archive.js):
   - Client-side archive builder using `JSZip`.
   - Packs originals, thumbnails, and `metadata.json`.

### Phase 6: Unified API Bridge & UI Refactoring
1. Refactor [`client/src/lib/api.js`](file:///d:/Projects/caps/client/src/lib/api.js) to delegate transparently to `db.js`, `photo-engine.js`, `p2p-mesh.js`, `gdrive.js`, and `archive.js`.
2. Update [`client/src/App.svelte`](file:///d:/Projects/caps/client/src/App.svelte):
   - Add P2P Live Connection status badge.
   - Add Google Drive 1-click Connect modal.
   - Update image preview URLs to use Object URLs (`URL.createObjectURL(blob)`).
   - Ensure seamless Hash/History routing for static SPA hosting.

### Phase 7: Static Deployment & CI/CD
1. Add [`vercel.json`](file:///d:/Projects/caps/vercel.json) for 1-click Vercel SPA deployment.
2. Update root `package.json` with simplified client build scripts.
