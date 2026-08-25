# 📸 Caps v2 — Server-less Event Photo Hub

> **Caps v2** is a 100% serverless, client-first event photo sharing hub inspired by the architecture of [Sonata](https://github.com/jethfrane/Sonata). It runs **entirely in your web browser** with zero dedicated backend servers, zero database costs, peer-to-peer WebRTC photo sharing, and direct Google Drive cloud backup.

---

## 🌟 What's New in Version 2 (Server-less Architecture)

- ⚡ **Zero Backend Servers**: No Node.js server, Python backend, or local command line needed to run during live events.
- 🌐 **100% Static Deployment**: Deployable directly to **GitHub Pages** (`https://<user>.github.io/caps/`) and **Vercel** (`https://caps.vercel.app/`).
- 🔒 **Client-Side Database**: Powered by **IndexedDB (Dexie.js)** directly in the browser sandbox.
- 📱 **Real-Time WebRTC P2P Mesh**: Photos stream directly from guest mobile phones to the host laptop/TV slideshow over WebRTC data channels with public tracker signaling (`trystero`).
- 🖼️ **In-Browser Image Engine**: Resizing, thumbnail generation (360px), EXIF stripping, and SHA-256 duplicate detection executed client-side via HTML5 `OffscreenCanvas` & `exifr`.
- ☁️ **Sonata-Style Google Drive Backup**: 1-click Google OAuth 2.0 (GIS) with restricted `drive.file` scope. Automatically creates `/Caps Events/<Event Name>` in the host's personal Google Drive.
- 📦 **In-Memory ZIP Exporter**: Export full event archives (`.zip`) with `JSZip` + `FileSaver.js` in under 2 seconds.

---

## 🔀 Versioning & Rollback

- **Version 1 (`main` branch / `v1.0.0` tag)**: Contains the original local-first Node.js/SQLite server monolith.
  ```bash
  git checkout main   # or git checkout v1.0.0
  ```
- **Version 2 (`v2` branch)**: Active branch for the server-less static web application.
  ```bash
  git checkout v2
  ```

---

## 🚀 Quick Start (Local Development)

Run Caps v2 locally without any backend server or database setup:

```bash
# 1. Navigate to client
cd client

# 2. Install dependencies
npm.cmd install

# 3. Start Vite dev server
npm.cmd run dev
```

Open `http://localhost:5173/` in your browser.

---

## 🌐 Deploying to GitHub Pages

Caps v2 is designed specifically for **GitHub Pages** (with relative base paths and hash routing):

1. Build the production static bundle:
   ```bash
   npm.cmd --prefix client run build
   ```
2. The output in `client/dist/` is completely static and self-contained (including `.nojekyll`).
3. Push `client/dist/` to your `gh-pages` branch or configure GitHub Actions to deploy on push.
4. Access your live event hub at: `https://<your-username>.github.io/caps/#/`

---

## 🍰 Implementation Status (Vertical Slices)

| Slice | Title | Status |
| :--- | :--- | :--- |
| **Slice 1** | Client DB (Dexie.js) & Local Event Hub | ✅ **Completed** |
| **Slice 2** | Browser Photo Engine (Canvas, Thumbnails, EXIF & Hashes) | 🔄 **In Progress** |
| **Slice 3** | Zero-Backend Real-Time P2P Sharing (WebRTC Mesh) | ⏳ Pending |
| **Slice 4** | Live Moderation, Gallery & TV Slideshow Sync | ⏳ Pending |
| **Slice 5** | Sonata-Style Direct Google Drive Cloud Sync | ⏳ Pending |
| **Slice 6** | Client-Side Full Archive ZIP Exporter (JSZip) | ⏳ Pending |
| **Slice 7** | Static SPA Deployment, PWA & Vercel Configuration | ⏳ Pending |

---

## 📄 License & Credits
Developed with ❤️ by NCCF Media Team & Open Source Community. Released under the MIT License.
