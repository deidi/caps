# 📸 Caps v2 — Server-less Event Photo Hub

> **Caps v2** is a 100% serverless, client-first event photo sharing hub. It runs **entirely in your web browser** with zero dedicated backend servers, zero database costs, peer-to-peer WebRTC photo sharing, and direct Google Drive cloud backup.

---

## 🌟 Key Features

- ⚡ **Zero Backend Servers**: No Node.js server, Python backend, or local command line needed to run during live events.
- 🌐 **Static Deployment**: Designed specifically for **GitHub Pages** (`https://deidi.github.io/caps/#/`).
- 🔒 **Client-Side Database**: Powered by **IndexedDB (Dexie.js)** with SHA-256 host PIN hashing and session tokens.
- 📱 **Real-Time WebRTC P2P Mesh**: Photos stream directly from guest mobile phones to the host laptop/TV slideshow over WebRTC data channels with public tracker signaling (`trystero`).
- 🖼️ **In-Browser Image Engine**: Resizing (2048px), thumbnail generation (360px), EXIF orientation/stripping, and SHA-256 duplicate detection executed client-side via HTML5 `OffscreenCanvas` & `exifr`.
- ☁️ **Direct Google Drive Cloud Backup**: 1-click Google OAuth 2.0 (GIS) with restricted `drive.file` scope. Automatically creates `/Caps Events/<Event Name>` in the host's personal Google Drive with full database snapshots (`event_manifest.json`).
- 📦 **In-Memory ZIP Exporter**: Export full event archives (`.zip`) with `JSZip` + `FileSaver.js` in under 2 seconds.
- 📴 **Offline PWA**: Full Service Worker (`sw.js`) and PWA manifest (`manifest.json`) pre-caching the app shell for offline use.

---

## 🌐 Running via GitHub Pages

Caps v2 is designed to run directly on **GitHub Pages** with zero setup.

### 1. Enable GitHub Pages (One-Time Setup)
1. Open your repository settings: [github.com/deidi/caps/settings/pages](https://github.com/deidi/caps/settings/pages)
2. Under **Build and deployment > Source**, select **`GitHub Actions`**.
3. The included workflow (`.github/workflows/deploy.yml`) will automatically build and publish the app on every push to `main`.

### 2. Live Web App URL
Once the GitHub Action completes, your app is live at:
👉 **[https://deidi.github.io/caps/#/](https://deidi.github.io/caps/#/)**

---

## 📱 How to Use During an Event

| Role / Device | URL | Instructions |
| :--- | :--- | :--- |
| **💻 Host (Laptop/PC)** | `https://deidi.github.io/caps/#/` | 1. Enter Host Name & PIN to set up.<br>2. Click **`+ Create New Event`** (e.g. `sunday-worship`).<br>3. Open the event dashboard and click **`📱 QR Code`** to display on venue screens or print. |
| **📱 Guests (Smartphones)** | `https://deidi.github.io/caps/#/event/<slug>` | 1. Scan the host's QR code or open the link on any phone.<br>2. Enter their name (e.g. `Sarah`) and tap **Join Event**.<br>3. Snap photos with their phone camera and upload! |
| **📺 TV / Projector Mode** | `https://deidi.github.io/caps/#/event/<slug>/slideshow` | 1. Open on the projector or TV browser.<br>2. Press **`F`** for fullscreen mode.<br>3. Photos approved in real-time by the host will automatically appear in the live slideshow rotation. |

---

## 🔀 Versioning & Rollback

- **Version 2 (`main` branch / `v2.0.0` tag)**: Active server-less static single-page application.
  ```bash
  git checkout main   # or git checkout v2.0.0
  ```
- **Version 1 (`v1.0.0` tag)**: Original local-first Node.js / SQLite monolith server.
  ```bash
  git checkout v1.0.0
  ```

---

## 🚀 Quick Start (Local Development)

Run Caps v2 locally without any backend server or database setup:

```bash
# 1. Install root & client dependencies
npm.cmd install
npm.cmd --prefix client install

# 2. Start Vite dev server
npm.cmd run dev
```

Open `http://localhost:5173/` in your browser.

To test the production build locally:
```bash
npm.cmd run build
npm.cmd run preview
```

---

## 🍰 Implementation Status (Vertical Slices)

| Slice | Title | Status |
| :--- | :--- | :--- |
| **Slice 1** | Client DB (Dexie.js) & Local Event Hub | ✅ **Completed** |
| **Slice 2** | Browser Photo Engine (Canvas, Thumbnails, EXIF & Hashes) | ✅ **Completed** |
| **Slice 3** | Zero-Backend Real-Time P2P Sharing (WebRTC Mesh) | ✅ **Completed** |
| **Slice 4** | Live Moderation, Gallery & TV Slideshow Sync | ✅ **Completed** |
| **Slice 5** | Direct Google Drive Cloud Backup (GIS + Drive REST API v3) | ✅ **Completed** |
| **Slice 6** | Client-Side Full Archive ZIP Exporter (JSZip) | ✅ **Completed** |
| **Slice 7** | Static SPA Deployment, PWA & GitHub Pages Workflow | ✅ **Completed** |

---

## 📄 License & Credits
Developed with ❤️ by NCCF Media Team & Open Source Community. Released under the MIT License.
