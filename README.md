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

## 📄 License & Credits
Developed with ❤️ by deidi & Open Source Community. Released under the MIT License.
