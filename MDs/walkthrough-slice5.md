# Caps — Walkthrough: Slice 5 Delivered

## Overview

**Slice 5 (Guest Photo Management + Downloads)** has been implemented, verified, and integrated with Slices 1 through 4.

---

## What Was Implemented

### 1. Soft Delete & Disk Management (`server/src/routes/photos.js`)
- **Safe Soft Delete (`DELETE /api/events/:slug/photos/:id`)**:
  - Automatically moves physical original photo from `data/events/:slug/originals/` into `data/events/:slug/deleted/` on disk (preserving host backup on local storage).
  - Removes the record from the active SQLite database.
  - Decrements the guest's `upload_count` by 1 (`UPDATE guests SET upload_count = MAX(0, upload_count - 1)`), immediately freeing up their upload quota slot.
  - Broadcasts `photo:removed` via WebSocket to all connected devices to pull down the photo instantly.
- **Ownership Verification**:
  - Verifies that attendees can only delete photos uploaded under their own guest session token. Attempts to delete another attendee's photos are rejected with `403 Forbidden`.

### 2. Full-Resolution & Streaming ZIP Downloads
- **Single Photo Download (`GET /api/events/:slug/photos/:id/download`)**:
  - Serves full-resolution original capture with `Content-Disposition: attachment`.
- **Multi-Photo Streaming ZIP (`POST /api/events/:slug/photos/download-zip`)**:
  - Accepts an array of selected photo IDs and streams a `.zip` archive on the fly using `archiver`.
- **Full Gallery Download (`GET /api/events/:slug/photos/download-all` & `/api/events/:slug/download-all`)**:
  - Streams all approved memories from the event into a single `.zip` file for both attendees and church staff.

### 3. Svelte 5 Client Updates (`client/src/App.svelte`)
- **Attendee "My Uploads" Management**:
  - Quick delete button (&times;) on each uploaded thumbnail with confirmation prompt.
  - Instantly recalculates quota in the UI (e.g. `20 / 20` &rarr; `19 / 20`).
- **Interactive Multi-Selection Mode**:
  - **"Select Photos"** toggle button in the Live Gallery header.
  - Checkbox selection overlay on each memory card.
  - Floating action toolbar showing selection counter and one-click **"Download Selected (X) .ZIP"**.
- **Lightbox Download Integration**:
  - Lightbox viewer includes both direct full-res download and owner delete buttons.
- **Host & Guest "Download All (.ZIP)"**:
  - Available in both Host Event Management Space and Guest Live Wall.

---

## Verification Results

### Automated Integration Test Suite (`server/test-slice5.js`)
All 8 test cases passed:
1. Host setup and event space creation (`NCCF Community Outreach`) ✅
2. Guest registration for Alice and Bob ✅
3. Multi-guest photo uploads (Alice: 2, Bob: 1) ✅
4. Unauthorized delete security check (Bob attempting to delete Alice's photo blocked with `403 Forbidden`) ✅
5. Legitimate soft delete by Alice: file relocated to `data/events/:slug/deleted/` and upload quota slot restored ✅
6. Single photo full-resolution download verification (`/photos/:id/download`) ✅
7. Multi-photo selected ZIP stream verification (`POST /photos/download-zip`) ✅
8. Full event gallery ZIP stream verification (`/download-all`) ✅
9. Zero regressions across all previous test suites (`test-slice1` through `test-slice5`) ✅

---

## Next Steps

Ready to proceed to **Slice 6: Slideshow / TV Mode**:
- Fullscreen projector / TV slideshow view (`/event/:slug/slideshow` or `/event/:slug/tv`)
- Auto-cycling through approved photos with configurable transition timing (e.g. 5s per photo)
- Real-time injection of newly approved photos into the active presentation carousel
- Picture-in-picture QR code overlay for projector screens (allowing attendees to scan while watching the live slideshow)
- Smooth Ken Burns zoom/pan effect or cross-fade transitions
