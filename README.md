# 📸 EventCaps — Server-less Event Photo Hub

> **EventCaps** is a 100% serverless, cloud-first event photo sharing hub. It runs **entirely in the web browser** with zero dedicated backend servers, zero database costs, direct **Google Drive cloud hosting for 100+ attendees**, and real-time live slideshow streaming.

---

## 🌟 Key Features

- ⚡ **Zero Backend Servers**: Pure static SPA with zero Node.js servers, Python backends, or local command-line dependencies required during live events.
- 🌐 **Static GitHub Pages Deployment**: Designed specifically for **GitHub Pages** (`https://deidi.github.io/event-caps/#/`).
- ☁️ **1-Click Google Drive Cloud Hosting**: Direct HTTP photo uploads from 100+ guest smartphones directly into the host's personal Google Drive folder hierarchy (`/EventCaps Events/<Event Name>/originals` and `/thumbnails`).
- 🚀 **Google Cloud CDN Delivery**: TV slideshows and live galleries stream photos and thumbnails directly from Google's high-speed global image CDN.
- 📡 **Lightweight Real-Time Signaling**: Instant sub-second notification broadcasting (`photo:uploaded`, `photo:approved`, `photo:deleted`) across all devices without heavy peer-to-peer data channel bottlenecks.
- 🔒 **Client-Side Database**: Powered by **IndexedDB (Dexie.js)** with SHA-256 host PIN security, session tokens, and local cache.
- 🖼️ **In-Browser Image Engine**: Resizing (2048px), thumbnail generation (360px), EXIF orientation correction/stripping, and SHA-256 duplicate detection executed client-side via HTML5 `OffscreenCanvas` & `exifr`.
- 📺 **TV & Projector Slideshow Mode**: Fullscreen real-time presentation view with auto-advancing carousel, custom transition timing, and live QR code overlay.
- 📦 **In-Memory ZIP Exporter**: Export full event archives (`.zip`) with `JSZip` + `FileSaver.js` in under 2 seconds.
- 📴 **Offline PWA**: Full Service Worker (`sw.js`) and PWA manifest (`manifest.json`) pre-caching the app shell for offline reliability.

---

## 🏗️ Architecture Overview

```
                                      ┌──────────────────────────────────────────────┐
                                      │  📱 Guest Smartphone (100+ Attendees)        │
                                      └──────┬───────────────────────────────▲───────┘
                                             │                               │
                      1. Request Upload Slot │                               │ 3. Direct Binary PUT
                         (Tiny JSON, ~100B)  │                               │    (Bypasses host)
                                             ▼                               │
┌──────────────────────────────────────────────┐                             │
│  💻 Host Laptop / Dashboard                  │                             │
│  - 1-Click Google Connected                  │                             │
│  - Generates Signed Resumable Upload Session ├─────────────────────────┐   │
└──────────────────────────────────────────────┘                         │   │
                                                                         ▼   │
                                                       ┌─────────────────────┴────────┐
                                                       │  ☁️ Google Cloud Drive & CDN  │
                                                       │  /EventCaps Events/<Event>/  │
                                                       └──────────────────────────────┘
```

---

## 🌐 Running via GitHub Pages

EventCaps is designed to run directly on **GitHub Pages** with zero setup.

### 1. Enable GitHub Pages (One-Time Setup)
1. Open your repository settings: [github.com/deidi/event-caps/settings/pages](https://github.com/deidi/event-caps/settings/pages)
2. Under **Build and deployment > Source**, select **`GitHub Actions`**.
3. The included workflow (`.github/workflows/deploy.yml`) will automatically build and publish the app on every push to `main`.

### 2. Live Web App URL
Once the GitHub Action completes, your app is live at:
👉 **[https://deidi.github.io/event-caps/#/](https://deidi.github.io/event-caps/#/)**

---

## 🔑 Google Drive Setup (For Event Hosts)

To enable 100+ guest cloud uploads to your Google Drive:

1. Open the **[Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)**.
2. Click **Create Credentials > OAuth client ID**.
3. Set Application type to **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `https://deidi.github.io`
   - `http://localhost:5173` *(for local development)*
5. Under **APIs & Services > OAuth consent screen** (or [Audience](https://console.cloud.google.com/auth/audience)):
   - Add your host email under **Test users**, or click **Publish App**.
6. In EventCaps, click **"☁️ Connect Google Drive (100+ Mode)"**, paste your Client ID once, and sign in.

---

## 📱 How to Use During an Event

| Role / Device | URL | Instructions |
| :--- | :--- | :--- |
| **💻 Host (Laptop/PC)** | `https://deidi.github.io/event-caps/#/` | 1. Enter Host Name & PIN to set up.<br>2. Connect Google Drive.<br>3. Click **`+ Create New Event`** (e.g. `sunday-worship`).<br>4. Click **`📱 QR Code`** to display on venue screens or print. |
| **📱 Guests (Smartphones)** | `https://deidi.github.io/event-caps/#/event/<slug>` | 1. Scan the host's QR code or open the link on any phone.<br>2. Enter their name (e.g. `Sarah`) and tap **Join Event**.<br>3. Snap photos with their phone camera and upload! |
| **📺 TV / Projector Mode** | `https://deidi.github.io/event-caps/#/event/<slug>/slideshow` | 1. Open on the projector or TV browser.<br>2. Press **`F`** for fullscreen mode.<br>3. Approved photos appear dynamically in real-time. |

---

## 🚀 Quick Start (Local Development)

Run EventCaps locally without any backend server or database setup:

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

## 📄 License & Credits
Developed with ❤️ by NCCF Media Team & Open Source Community. Released under the MIT License.
