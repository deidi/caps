# 📸 Caps — Event Photo Hub

**Caps** is a self-hosted, local-network-first event photo sharing hub designed for live church services and community gatherings. Non-technical staff can run it on a host laptop without an internet connection, allowing attendees to scan a QR code, share memories from their phone cameras in real-time, and watch a live TV slideshow.

---

## 🚀 Quick Start (Testing the App)

### Option 1: Single-Click Windows Batch Launcher (Recommended)
Double-click [`launch-caps.bat`](file:///d:/Projects/Caps/launch-caps.bat) in the project root:
- Checks system environment
- Automatically builds the frontend UI if needed
- Starts the Caps server
- Automatically launches the Host Dashboard in your default browser at `http://localhost:1000`

---

### Option 2: PowerShell Launcher
Right-click [`launch-caps.ps1`](file:///d:/Projects/Caps/launch-caps.ps1) and choose **Run with PowerShell**, or in terminal:
```powershell
.\launch-caps.ps1
```

---

### Option 3: Standard NPM Commands
From the project root:
```bash
npm start
```
Or to run the client and server separately in live development mode:
```bash
npm run server:dev   # Starts server on http://localhost:1000
npm run client:dev   # Starts Vite dev server on http://localhost:5173
```

---

## 📱 How to Test Attendee & Host Flows

### 1. Host Setup
1. Open `http://localhost:1000` in your browser.
2. Complete first-time setup with your name (e.g. `Media Team`) and a 4-digit PIN (e.g. `1234`).
3. Click **"+ Create New Event"** and enter event details (e.g., `Sunday Worship & Praise`).

### 2. Attendee Photo Capture & Upload
1. From the Host Dashboard, click **"📱 QR Code"** to view the join QR code or click **"👀 Guest View"**.
2. Open `http://localhost:1000/event/<slug>` in a separate browser tab or on a phone connected to the same WiFi network (using the LAN IP displayed on the server startup banner, e.g., `http://192.168.1.14:1000/event/<slug>`).
3. Enter a guest name (e.g., `Sarah`), take or select photos, and submit.

### 3. Moderation & Live Wall
1. Back on the Host tab, switch to the **"Moderation Queue"** tab.
2. Click **"Approve"** (or **"Approve All"**) to publish photos to the live wall.
3. Observe real-time updates across the attendee's live gallery without refreshing!

### 4. TV / Projector Slideshow Mode
1. Click **"📺 Launch TV Slideshow"** or navigate to `http://localhost:1000/event/<slug>/slideshow`.
2. Press **`F`** to toggle full-screen, **`Space`** to pause/resume, and **`Arrow Keys`** to advance slides.
3. Newly approved photos will automatically inject into the live rotation!

### 5. Google Drive Backup & Full Archive Export
1. Click **"☁️ Google Drive Backup"** to test 1-click cloud sync of approved high-resolution photos.
2. Click **"📦 Export Full Archive"** to download a single `.zip` containing all originals, thumbnails, and `metadata.json`.

---

## ⚙️ Configuration File (`caps.config.json`)

You can customize the host credentials, admin PIN, and port in [`caps.config.json`](file:///d:/Projects/Caps/caps.config.json):
```json
{
  "host_name": "NCCF Media Team",
  "admin_pin": "1234",
  "port": 1000
}
```
Whenever the server boots, it automatically synchronizes the admin credentials from this file.

---

## 🧹 Database Reset & Cleaning

To wipe all test events, photos, and guest records and start with a completely fresh, clean database:

```bash
npm run db:reset
# or
npm run clean
```

This command will:
1. Clear all photos, guests, events, and sync logs from SQLite.
2. Remove all uploaded images and thumbnails from the `server/data/events/` directory on disk.
3. Automatically re-seed the host credentials using the settings from `caps.config.json`.

---

## 📦 Offline Windows 10/11 Deployment (Clean / Reformatted PC)

Caps includes a **standalone, self-contained offline installer** that runs on freshly reformatted Windows 10/11 computers **without needing Node.js or internet access**:

### How to Deploy to a Clean Windows Laptop:
1. Copy [`dist-offline/Caps-v1.0.0-Windows-Offline.zip`](file:///d:/Projects/Caps/dist-offline/Caps-v1.0.0-Windows-Offline.zip) to a USB flash drive.
2. Plug the USB into the clean Windows 10/11 host laptop and extract the folder.
3. Double-click **[`install-caps-offline.bat`](file:///d:/Projects/Caps/install-caps-offline.bat)**.
   - It will automatically configure the Windows Firewall for Port 1000.
   - It will create a **"Caps Photo Hub"** desktop shortcut.
   - It uses the bundled portable Node.js runtime (`runtime/node.exe`) with zero prerequisite installs.
4. Open the Host Dashboard at `http://localhost:1000` (Admin PIN: `1234` in `caps.config.json`).

### Rebuilding the Offline Package:
If you make code changes and wish to rebuild the standalone offline ZIP package:
```bash
npm run package:offline
```
