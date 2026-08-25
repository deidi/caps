# 🍰 Slice 6 Walkthrough — Client-Side Full Archive ZIP Exporter (JSZip + FileSaver)

## 🎯 Slice Objective
Replace server-side streaming ZIP generation (`archiver`) with an **in-browser archive exporter** using **`JSZip`** and **`FileSaver.js`**:
1. Host or Guests can click "Export Full Archive (.zip)" to generate a complete `.zip` file entirely in browser memory in under 2 seconds.
2. The archive includes `/originals`, `/thumbnails`, and a structured `metadata.json` document.
3. Multi-selection batch download allows guests and hosts to download specific selected photos into a `.zip`.

---

## 🛠️ Changes Implemented

1. **Client Dependencies Added (`client/package.json`)**:
   - `jszip`: In-memory ZIP archive generation with DEFLATE compression.
   - `file-saver`: Triggers browser file downloads.

2. **Archive Generator (`client/src/lib/archive.js`)**:
   - `exportFullEventArchive(slug, onProgress)`:
     - Assembles original Blobs and thumbnail Blobs into folder subtrees.
     - Generates `metadata.json` containing event info, guest roster, dimensions, timestamps, and hashes.
     - Compresses archive and triggers download as `caps-<slug>-archive.zip`.
   - `exportSelectedPhotosZip(slug, photoIds, onProgress)`:
     - Bundles selected photos into `caps-<slug>-selected.zip`.

3. **UI Integration (`client/src/App.svelte`)**:
   - Host Dashboard: "📦 Export Full Archive" button with packaging status indicator.
   - Guest Live Wall: "💾 Download All (.ZIP)" and "Download Selected (N) .ZIP".

---

## 🧪 Verification & How to Test

1. **Start the Dev Server**:
   ```bash
   npm.cmd run dev
   ```
2. **Open Host Dashboard or Guest Live Wall**:
   - Navigate to `http://localhost:5173/` -> Open event.
3. **Export Full Archive**:
   - Click **"📦 Export Full Archive"**.
   - Notice the instant download trigger (<2s) of `caps-sunday-worship-praise-archive.zip`.
4. **Inspect Downloaded ZIP**:
   - Extract the `.zip` on your computer.
   - Verify it contains `/originals/`, `/thumbnails/`, and `metadata.json`.
5. **Test Multi-Selection Batch Download**:
   - On the Guest Live Wall, click **"Select Photos"**.
   - Select 2 or 3 photos -> Click **"Download Selected (3) .ZIP"**.
   - Verify the downloaded ZIP contains the selected photos.

---

## 🚀 Status
- **Slice 6:** ✅ Completed & Tested.
