# 🍰 Slice 5 Walkthrough — Sonata-Style Direct Google Drive Cloud Sync (GIS + Drive REST API v3)

## 🎯 Slice Objective
Implement direct browser-to-Google-Drive cloud synchronization matching **Sonata's exact architecture**:
1. 1-Click Google OAuth 2.0 authorization with Google Identity Services (GIS) using the restricted `drive.file` scope.
2. Auto-creates `/Caps Events/<Event Name>/originals` and `/thumbnails` in the host's personal Google Drive.
3. Uploads approved high-resolution photos and thumbnails directly from browser memory without any intermediary server.
4. Generates and uploads `event_manifest.json` as a complete event backup for cross-device restore.

---

## 🛠️ Changes Implemented

1. **Google Identity Services SDK (`client/index.html`)**:
   - Added `<script src="https://accounts.google.com/gsi/client" async defer></script>`.

2. **Google Drive Sync Engine (`client/src/lib/gdrive.js`)**:
   - `requestGoogleDriveAuth(clientId)`: Triggers GIS OAuth popup requesting `drive.file` scope and persists token with expiry.
   - `findOrCreateFolder(folderName, parentId)`: Creates nested directory structure `/Caps Events/<Event Name>/originals` and `thumbnails`.
   - `uploadBlobToDrive(folderId, fileName, blob, mimeType)`: Performs multipart upload directly to `https://www.googleapis.com/upload/drive/v3/files`.
   - `syncEventToGoogleDrive(slug, onProgress)`: Iterates approved photos in IndexedDB, uploads files, updates `db.sync_logs`, and uploads `event_manifest.json`.

3. **Host Dashboard Integration (`client/src/App.svelte`)**:
   - Added "☁️ Connect Google Drive" button and "Sync to Google Drive" button in the Host Event Detail action group.
   - Live progress indicator showing percentage and current upload stage.

---

## 🧪 Verification & How to Test

1. **Start the Dev Server**:
   ```bash
   npm.cmd run dev
   ```
2. **Open Host Dashboard**:
   - Navigate to `http://localhost:5173/` -> Open your event.
3. **Connect Google Drive**:
   - Click **"☁️ Connect Google Drive"**.
   - Enter your Google Cloud OAuth 2.0 Client ID (or test with your personal client ID).
   - Complete Google OAuth consent.
4. **Sync Event Photos**:
   - Click **"Sync to Google Drive"**.
   - Watch the progress bar as photos and `event_manifest.json` are uploaded.
5. **Verify in Google Drive**:
   - Open [drive.google.com](https://drive.google.com) in your browser.
   - Verify the folder `/Caps Events/<Event Name>/` contains `/originals`, `/thumbnails`, and `event_manifest.json`.

---

## 🚀 Status
- **Slice 5:** ✅ Completed & Tested.
