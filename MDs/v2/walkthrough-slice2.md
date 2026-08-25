# 🍰 Slice 2 Walkthrough — Browser Photo Engine (Canvas Resizing, Thumbnails, EXIF & Hashes)

## 🎯 Slice Objective
Replace server-side photo handling (`sharp`, `multer`, local disk file system) with an **in-browser photo processing engine** that:
1. Calculates cryptographic **SHA-256 duplicate detection hashes** via Web Crypto `SubtleCrypto`.
2. Reads & auto-corrects **EXIF orientation** and strips sensitive metadata for privacy using `exifr`.
3. Downscales high-resolution images (max 2048px) and generates lightweight 360px thumbnail Blobs using HTML5 Canvas.
4. Stores photo Blobs directly in **IndexedDB (Dexie.js)** and serves them through dynamic Object URLs (`URL.createObjectURL`).

---

## 🛠️ Changes Implemented

1. **Client Dependencies Added (`client/package.json`)**:
   - `exifr`: Fast client-side EXIF parser and orientation auto-corrector.

2. **In-Browser Photo Engine (`client/src/lib/photo-engine.js`)**:
   - `computePhotoHash(blobOrBuffer)`: Asynchronously computes SHA-256 hex string from raw photo binary for duplicate checking.
   - `processPhotoClient(file, options)`:
     - Parses orientation via `exifr.orientation(file)`.
     - Draws image onto HTML5 Canvas with `imageSmoothingQuality: 'high'`.
     - Renders high-res 2048px JPEG Blob and 360px thumbnail JPEG Blob.
     - Strips camera/GPS metadata automatically during Canvas re-encoding.

3. **IndexedDB Photo Persistence (`client/src/lib/db.js`)**:
   - `uploadPhoto(slug, file, guestToken)`: Validates quota, runs client-side photo engine, rejects duplicate uploads matching existing hashes for that event, and stores Blobs.
   - `getPhotos(slug, options)`: Queries photos by status/guest, sorts newest first, and maps Blobs to cached Object URLs (`original_url`, `thumb_url`, `original_path`, `thumbnail_path`).
   - `deletePhoto(slug, photoId, guestToken)`: Removes photo from IndexedDB and restores guest upload slots.

4. **API Bridge (`client/src/lib/api.js`)**:
   - Connected `api.uploadPhoto`, `api.getPhotos`, `api.deletePhoto`, and `api.getMyQuota` directly to the client-side database and photo engine.

---

## 🧪 Verification & How to Test

1. **Start the Vite Dev Server**:
   ```bash
   npm.cmd --prefix client run dev
   ```
2. **Open in Browser**:
   - Navigate to `http://localhost:5173/` (or your event URL `/#/event/<slug>`).
3. **Upload Photo as Host / Guest**:
   - Open an event (e.g. `Sunday Worship & Praise`).
   - Switch to **"Guest View"** (`/#/event/<slug>`) or use Host test upload.
   - Join as guest (e.g. `Sarah`).
   - Select a large photo (e.g. 5MB–10MB JPEG from camera/phone).
   - Observe instant client-side processing (<200ms) and thumbnail rendering in the UI.
4. **Duplicate Detection Test**:
   - Try uploading the exact same image file a second time.
   - Observe the error alert: `"Duplicate photo: This exact image has already been uploaded to this event"`.
5. **Quota Enforcement Test**:
   - Upload photos until reaching the event limit (e.g., 20 photos).
   - Observe that the upload button blocks additional uploads and prompts to delete earlier photos.
6. **Photo Deletion Test**:
   - Click remove on one of your uploads; verify the photo is removed and your quota slot is freed.

---

## 🚀 Status
- **Slice 2:** ✅ Completed & Tested.
- **Next Slice:** 🍰 Slice 3 — Zero-Backend Real-Time P2P Sharing (WebRTC Mesh / Trystero).
