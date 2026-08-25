# 🍰 Slice 1 Walkthrough — Client Database (Dexie.js) & Local Event Hub

## 🎯 Slice Objective
Transform the core Host management flow (First-time Host Setup, PIN lock/unlock, Event creation, Event listing, Event details, and Settings) into a **100% serverless, client-side application** powered by browser **IndexedDB (Dexie.js)** with zero Node.js backend required.

---

## 🛠️ Changes Implemented

1. **Client Dependencies Added (`client/package.json`)**:
   - `dexie`: IndexedDB wrapper for schema definitions and reactive queries.
   - `qrcode`: Browser-native QR code generator for dynamic guest join links.

2. **IndexedDB Database Engine (`client/src/lib/db.js`)**:
   - Initialized `caps_v2_db` with relational stores:
     - `settings` (Host Name, PIN hash using native Web Crypto `SubtleCrypto` SHA-256)
     - `events` (Event title, slug, date, moderation toggle, guest limits, status)
     - `guests` (Guest name, token, upload quota tracking)
     - `photos` (Event slug, guest name, hash, status, timestamps)
     - `sync_logs` (Cloud sync logs)
   - Created pure client methods:
     - `setupHost(host_name, pin)` & `verifyPin(pin)`
     - `createEvent(data)` with automated slugification and collision resolution
     - `getEvents()` with computed photo/guest counters
     - `getEvent(slug)`, `updateEventStatus(slug, status)`, and `deleteEvent(slug)`
     - `getEventQR(slug)` generating QR Data URLs in-browser.

3. **Unified Client API Adapter (`client/src/lib/api.js`)**:
   - Rewired `api.*` methods to invoke local IndexedDB routines instead of sending network `fetch('/api/...')` requests.

4. **Routing & UI (`client/src/App.svelte`)**:
   - Added support for both hash routing (`/#/`, `/#/event/:slug`, `/#/event/:slug/slideshow`) and path routing for universal static hosting.
   - Verified Host Setup, Lock/Unlock, Event Creation modal, Event Card listing, and Event Details shell.

---

## 🧪 Verification & How to Test

1. **Start the Vite Dev Server**:
   ```bash
   npm.cmd --prefix client run dev
   ```
2. **Open in Browser**:
   - Navigate to `http://localhost:5173/`.
3. **First-Time Host Setup**:
   - Enter Host Name: `NCCF Media Team`
   - Enter 4-Digit PIN: `1234`
   - Click **Save & Continue**.
4. **Create Events**:
   - Click **"+ Create New Event"**.
   - Event Name: `Sunday Worship & Praise`
   - Click **Create Event**.
   - Observe the new event created with slug `sunday-worship-praise`.
5. **Persistence Check**:
   - Refresh the page (`F5`).
   - Observe that the Host is automatically unlocked (or prompt for PIN if locked) and the event displays from IndexedDB with zero server network calls.
6. **QR Code Check**:
   - Click on the event -> Click **"📱 QR Code"**.
   - Observe the browser-generated QR code rendering cleanly.

---

## 🚀 Status
- **Slice 1:** ✅ Completed & Tested.
- **Next Slice:** 🍰 Slice 2 — Browser Photo Engine (Canvas Resizing, Thumbnails, EXIF & Hashes).
