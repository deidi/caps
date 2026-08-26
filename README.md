# 📸 EventCaps — Serverless Real-Time Event Photo Hub

> **EventCaps** is a 100% serverless, cloud-first event photo sharing hub. It runs **entirely in the web browser** with zero dedicated backend servers, zero database costs, direct **Google Drive cloud hosting for 100+ attendees**, real-time moderation, live memories walls, and dynamic TV slideshow streaming.

---

## 🌟 Key Features

- ⚡ **Zero Backend Servers**: Pure static SPA with zero Node.js servers, Python backends, or local command-line dependencies required during live events.
- 🌐 **Static GitHub Pages Deployment**: Designed specifically for **GitHub Pages** (`https://deidi.github.io/event-caps/#/`).
- ☁️ **1-Click Google Drive Cloud Hosting**: Direct HTTP photo uploads from 100+ guest smartphones directly into the host's personal Google Drive folder hierarchy (`/EventCaps Events/<Event Name>/originals` and `/thumbnails`).
- 🚀 **Google Cloud CDN Delivery**: TV slideshows and live galleries stream photos and thumbnails directly from Google's high-speed global image CDN.
- 📡 **Universal Real-Time Sync**: Instant sub-second photo broadcasting, MQTT retained gallery sync, and active request-response pull ensuring all early and newly joined guests view the full approved gallery.
- 👤 **Host Profile & PIN Security**: Easily customize host display name, role, and update Admin PIN directly from the top navigation header.
- 📊 **Real-Time Analytics & Leaderboard**: Track total uploads, approved vs. pending photos, active attendee count, disk storage consumed (MB), top contributor rankings, and hourly activity timeline graphs.
- 🔒 **Client-Side Database**: Powered by **IndexedDB (Dexie.js)** with SHA-256 host PIN security, session tokens, and offline image cache.
- 🖼️ **In-Browser Image Engine**: Resizing (2048px), thumbnail generation (360px), EXIF orientation correction/stripping, and SHA-256 duplicate detection executed client-side via HTML5 `OffscreenCanvas` & `exifr`.
- 📺 **TV & Projector Slideshow Mode**: Fullscreen real-time presentation view with auto-advancing carousel, custom transition timing, and live QR code overlay.
- 📦 **In-Memory ZIP Exporter**: Export full event archives (`.zip`) with `JSZip` + `FileSaver.js` in under 2 seconds.
- 📴 **Offline PWA with Network-First Cache**: Full Service Worker (`sw.js`) and PWA manifest (`manifest.json`) pre-caching the app shell with `no-store` network-first updates.
- 📜 **Built-in Google Compliance**: Dedicated Privacy Policy (`#/privacy`) and Terms of Service (`#/terms`) routes.

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

---

## 🌐 GitHub Pages Deployment Guide

EventCaps is designed to be deployed and hosted **100% free on GitHub Pages** with zero backend infrastructure.

### ⚙️ Option A: Automated CI/CD (GitHub Actions) — Recommended

The repository includes a two-stage GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and deploys your site whenever you push to the `main` branch.

#### 1. Enable GitHub Actions Deployment in Repo Settings
1. Open your repository on GitHub: **[https://github.com/deidi/event-caps/settings/pages](https://github.com/deidi/event-caps/settings/pages)**
2. Under **Build and deployment > Source**, choose:
   - **`GitHub Actions`** (Native Artifacts Deployment)
3. Push any commit to `main`, and the deployment job will trigger automatically.
4. Monitor build progress at: **[https://github.com/deidi/event-caps/actions](https://github.com/deidi/event-caps/actions)**

---

### 💻 Option B: One-Command Manual Deployment to `gh-pages`

If you prefer to deploy directly from your local development machine without waiting for GitHub Actions:

```powershell
# Run from repository root in PowerShell:
npm.cmd --prefix client run build
Copy-Item "client\dist\index.html" "client\dist\404.html" -Force
New-Item -Path "client\dist\.nojekyll" -ItemType File -Force
Push-Location "client\dist"
git init
git checkout -B gh-pages
git add -A
git commit -m "deploy: manual live production release"
git remote add origin https://github.com/deidi/event-caps.git
git push origin gh-pages -f
Pop-Location
Remove-Item -Path "client\dist\.git" -Recurse -Force -ErrorAction SilentlyContinue
```

*(If using this method, ensure your GitHub Pages Source is set to **`Deploy from a branch`** &rarr; **`gh-pages`** in repo settings).*

---

### 🛠️ Key Deployment Files & Mechanisms

- **`.github/workflows/deploy.yml`**: Two-stage GitHub Actions pipeline (`build` &rarr; `deploy`) that compiles Svelte, bundles Vite assets, and uploads the deployment artifact directly.
- **`client/dist/404.html`**: A copy of `index.html` ensuring that direct links to sub-routes (e.g. `#/event/my-event` or `#/privacy`) load properly without HTTP 404 errors on GitHub's static servers.
- **`client/dist/.nojekyll`**: Disables GitHub's default Jekyll static processor so that files starting with `_` or nested Vite assets are served correctly.
- **`client/public/sw.js`**: Service Worker with network-first `no-store` handling for app scripts, ensuring users receive instant updates on page load without stale cache locks.

---

### 🔗 Live Production URL
👉 **[https://deidi.github.io/event-caps/#/](https://deidi.github.io/event-caps/#/)**

---

## 🔑 Google Cloud Drive Setup (For Event Hosts)

To enable 100+ guest cloud uploads directly to your Google Drive:

1. Open the **[Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)**.
2. Click **Create Credentials > OAuth client ID**.
3. Set Application type to **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `https://deidi.github.io`
5. Under **APIs & Services > OAuth consent screen** (or [Audience](https://console.cloud.google.com/auth/audience)):
   - Set publishing status to **Production** or add your host Google email under **Test users**.
   - *Note: Do NOT click "Submit for Verification" — verification is not required for personal event hosting on `github.io`.*
6. In EventCaps, click **"☁️ Connect Google Drive (100+ Mode)"**, paste your Client ID once, and sign in.

---

## 📱 How to Use During an Event

| Role / Device | URL | Instructions |
| :--- | :--- | :--- |
| **💻 Host (Laptop/PC)** | `https://deidi.github.io/event-caps/#/` | 1. Enter Host Name & PIN to set up.<br>2. Connect Google Drive.<br>3. Click **`+ Create New Event`**.<br>4. Click **`📱 QR Code`** to display on venue screens.<br>5. Moderate guest uploads in real time or view **📊 Analytics**. |
| **📱 Guests (Smartphones)** | `https://deidi.github.io/event-caps/#/event/<slug>` | 1. Scan the host's QR code or open the link on any phone.<br>2. Enter their name (e.g. `Sarah`) and tap **Join Event**.<br>3. Snap photos with their phone camera and watch approved memories appear on the **Live Memories Wall**! |
| **📺 TV / Projector Mode** | `https://deidi.github.io/event-caps/#/event/<slug>/slideshow` | 1. Open on the projector or TV browser.<br>2. Press **`F`** for fullscreen mode.<br>3. Approved photos stream dynamically in real-time. |

---

## 👤 Host Profile & PIN Security

To change your host display name, role, or update your Admin PIN:
1. Click the **`👤 [Host Name] ⚙️`** button in the top right navigation header.
2. Update your **Host Name / Role** (e.g. `Pastor John / Media Team`).
3. Enter your **Current Admin PIN** to authorize changes, and enter your **New Admin PIN**.
4. Click **Save Changes** — your credentials update instantly in local IndexedDB.

---

## 📊 Analytics Dashboard

Click the **📊 Analytics** tab inside any event to inspect real-time metrics:
- **Total Uploads**: Total photos received.
- **Approved & Live**: Count of photos currently shown to attendees.
- **Active Guests**: Number of unique attendees participating.
- **Disk Storage Used**: Total size of event photos in MB.
- **🏆 Top Guest Contributors**: Ranked leaderboard of guests by upload count.
- **⏱️ Activity Timeline by Hour**: Interactive bar graph showing photo submissions grouped chronologically.

---

## 📄 License & Credits
Developed with ❤️ by NCCF Media Team & Open Source Community. Released under the MIT License.
