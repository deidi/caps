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
                                 │     📱 Guest Smartphones (100+ Attendees)    │
                                 │  - In-Browser Resize & Thumbnail Gen (360px) │
                                 │  - Real-Time Live Memories Wall              │
                                 └──────┬───────────────────────────────▲───────┘
                                        │                               │
                1. Signaling & Approval │                               │ 3. Approved Media Stream
                   (MQTT / WebSockets)  │                               │    (Google CDN or P2P)
                                        ▼                               │
┌─────────────────────────────────────────────────────────┐             │
│              💻 Host Dashboard (Browser SPA)            │             │
│  - Event Configuration & SHA-256 PIN Security           │             │
│  - Real-Time Moderation Queue & Analytics Engine        ├─────────────┼────────────────────────┐
│  - Local Storage (IndexedDB) + 1-Click Google Drive Sync│             │                        │
└───────────────────────────┬─────────────────────────────┘             │                        │
                            │                                           │                        │
                            │ 2. Resumable Upload Session               │                        │
                            ▼                                           ▼                        ▼
              ┌───────────────────────────┐               ┌──────────────────────────┐ ┌───────────────────┐
              │ ☁️ Google Cloud Drive CDN │               │ 📺 Projector / TV Screen │ │ 📦 ZIP Archiver   │
              │  /EventCaps Events/<slug> │               │ - Real-Time Slideshow    │ │ - In-Memory Export│
              └───────────────────────────┘               └──────────────────────────┘ └───────────────────┘
```

---

## ➕ How to Create an Event

Creating a new event space takes under 30 seconds:

1. **Access the Host Dashboard**:
   - Open **[https://deidi.github.io/event-caps/#/](https://deidi.github.io/event-caps/#/)** on your computer or smartphone.
   - Enter your **Host Name & PIN** on first setup (or enter your 4-digit PIN to unlock).

2. **Click `+ Create New Event`**:
   - Click the primary **`+ Create New Event`** button on your dashboard toolbar.

3. **Configure Your Event Space**:
   - **Event Name**: The title of your gathering (e.g. `Annual Gala 2026`, `Emma & David's Wedding`, `Sunday Worship`).
   - **Date**: The scheduled date for the event.
   - **Tagline / Message** *(Optional)*: A custom welcome message shown on guest capture screens and the live slideshow.
   - **Per-Guest Upload Limit**: Set maximum photos allowed per guest (e.g. `5`, `10`, or `20` photos).
   - **Photo Moderation Queue**:
     - *Enabled (Recommended)*: Photos require host approval in the moderation queue before appearing on the public live wall or TV slideshow.
     - *Disabled*: Uploads stream live instantly to all screens without review.
   - **Strip EXIF Metadata**: Automatically strips GPS location coordinates and device information for attendee privacy.

4. **Launch & Share with Guests**:
   - Click **Create Event Space**.
   - In your newly created event, click **`📱 QR Code`** to:
     - Project fullscreen on venue TV screens (**`📺 Full-Screen TV Mode`**).
     - Download the QR code image (**`💾 Download PNG`**) to print on table cards or posters.

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

## 🛠️ Complete Application Functions & Features

EventCaps provides an all-in-one suite of tools for event hosts, photographers, and attendees:

### 🔐 1. Host Authentication & Security
- **One-Time Host Setup**: Initialize host profile with custom Display Name / Role and 4+ digit Admin PIN.
- **SHA-256 Security**: Passwords and session tokens are encrypted client-side using browser-native cryptography.
- **Header Profile & PIN Manager (`👤 [Host Name] ⚙️`)**: Update your display name or change your Admin PIN at any time with current PIN verification.
- **Dashboard Lock / Unlock**: Protect host controls and event spaces with quick PIN unlock.

### 🎪 2. Event Space Management
- **Instant Event Creation**: Set custom Event Name, scheduled Date, Tagline message, and per-guest upload limits (1–500).
- **Branding & Custom Logo**: Upload custom PNG/JPG event logos and update event taglines in real time.
- **Event Lifecycle Controls**:
  - **`🔒 Close Event`**: Concludes the event, displays a commemorative banner, and disables new uploads while keeping the live gallery open.
  - **`🟢 Reopen Event`**: Re-activates closed events to allow new uploads.
  - **`🗑️ Permanent Delete`**: Deletes the event and all associated photos/guest records from local storage.
- **QR Code Sharing**: Generates high-contrast QR codes for venue screens, printable posters, or table cards.

### 🛡️ 3. Real-Time Moderation Queue & 1-Click Auto-Approve
- **Live Review Feed**: Inspect incoming photos with guest attribution and upload timestamps.
- **1-Click Review Actions**:
  - **`Approve`** / **`Reject`**: Individual photo moderation.
  - **`Approve All`** / **`Reject All`**: Bulk batch actions for high-traffic moments.
- **⚡ 1-Click Auto-Approve Toggle**:
  - Switch between **`⚡ Auto-Approve: ON`** (new photos stream live instantly) and **`🛡️ Auto-Approve: OFF`** (manual review mode) directly in the queue header.
  - When activating Auto-Approve, one-click prompt lets you immediately approve all waiting photos.
- **Published Live Gallery Controls**:
  - **`↩️ Revert to Pending`**: Instantly removes an approved photo from live screens back into the moderation queue.
  - **`🗑️ Permanent Delete`**: Purges photos permanently across host and all attendee screens.
- **Full-Resolution Lightbox**: High-res preview with author details and original file download.

### 📱 4. Frictionless Guest Experience
- **Zero App Downloads**: Attendees join in seconds by scanning a QR code or opening `#/event/<slug>` in any mobile browser.
- **Simple Identity**: Enter attendee name once to start sharing memories.
- **In-Browser Image Engine**:
  - Automatically resizes raw photos to **2048px** for fast delivery.
  - Generates lightweight **360px thumbnails** for instant grid loading.
  - Corrects EXIF camera orientation and strips private GPS coordinates.
  - Computes SHA-256 hashes to prevent accidental duplicate uploads.
- **📊 Live Batch Upload Progress Widget**:
  - Real-time sequential counter (`Uploading Photos 2 of 5`).
  - Animated green progress track and percentage indicator (`0%–100%`).
  - Micro-status feedback: *“Optimizing image...”*, *“Streaming to Google Drive...”*, *“Delivered to Host Moderation Queue!”*.
- **My Shared Photos Feed**:
  - Live status badges: **🟡 Pending Review**, **🟢 Live on Wall**, **🔴 Rejected**.
  - **`&times;` Delete Button**: Allows guests to remove their own photos and immediately free up upload quota slots.

### 🖼️ 5. Live Memories Wall & Multi-Photo Exporter
- **Universal Real-Time Feed**: Sub-second photo broadcasting with MQTT retained state synchronization.
- **Multi-Photo Selection**: Select multiple photos to download as a custom batch `.ZIP` archive.
- **Download Full Event Album**: 1-Click export to download all approved event memories in an uncompressed `.ZIP` file.

### 📺 6. TV & Projector Slideshow Mode (`#/event/<slug>/slideshow`)
- **Fullscreen Presentation**: Designed for venue projectors, LED walls, and smart TV browsers.
- **Dynamic Auto-Advancing Stream**: Automatically cycles through newly approved photos in real time.
- **Keyboard Shortcuts**:
  - **`F`**: Enter / Exit Fullscreen mode.
  - **`Space`**: Pause / Resume slideshow carousel.
  - **`← / →`**: Manually advance or revisit slides.
- **Customizable Presentation Settings**: Adjust interval speed (3s, 5s, 10s), transition effects (fade, slide, zoom), author credit overlay, and live QR watermark.

### ☁️ 7. Dual Storage Architecture (IndexedDB & Google Drive 100+ Mode)
- **Local Browser Hub (Zero Setup)**: Runs 100% serverless using HTML5 IndexedDB (`Dexie.js`) inside the host's browser.
- **Google Drive Cloud Mode (100+ Attendees)**: 1-Click Google OAuth sign-in. Guests upload directly to Google Drive cloud folders via signed resumable sessions, bypassing host bandwidth limits.
- **Google Cloud CDN**: Streams high-speed media from Google's global content delivery network.
- **In-Memory ZIP Archiver**: Built-in `JSZip` + `FileSaver.js` generates ZIP archives on-the-fly in under 2 seconds.

### 📊 8. Event Engagement & Analytics Dashboard
- **Live Metric KPI Cards**: Total Uploads, Approved & Live count, Active Attendees, Storage Footprint in MB.
- **🏆 Top Guest Contributors**: Ranked leaderboard recognizing top attendee photographers.
- **⏱️ Activity Timeline by Hour**: Scaled interactive bar chart mapping photo submission volume over the course of the event.

### 📴 9. Offline PWA & Zero-Cache Resilience
- **Offline Upload Queue**: Photos captured without internet are queued locally and automatically flush when reconnected.
- **PWA Installation**: Installable as a native app icon on iOS and Android home screens.
- **Network-First Service Worker**: Implements `no-store` network-first caching so app updates deploy instantly without stale cache locks.
- **Built-in Compliance**: Dedicated **Privacy Policy (`#/privacy`)** and **Terms of Service (`#/terms`)** routes for Google OAuth compliance.

---

## 📄 License & Credits
Developed with ❤️ by deidi & Open Source Community. Released under the MIT License.
