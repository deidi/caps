# EventCaps Project Rules & Guidelines

## 🌟 Core Architecture (EventCaps v2.0)

1. **100% Serverless & Cloud-First**:
   - Pure static Single Page Application (SPA) built with **Svelte 5** (Runes syntax `$state`, `$derived`, `$effect`) + **Vite**.
   - Hosted directly on **GitHub Pages** (`https://deidi.github.io/event-caps/#/`).
   - Zero dedicated backend servers, Node.js runtime, or Python services required during live events.

2. **Data & Storage Layer**:
   - **Local / Default Mode**: Client-side **IndexedDB (Dexie.js)** with SHA-256 host PIN security, session tokens, and photo blob cache.
   - **Google Drive Cloud Mode (100+ Attendees)**: Direct Google Identity Services (GIS) OAuth integration, generating authenticated resumable upload sessions directly from guest phones to the host's Google Drive folders (`/EventCaps Events/<slug>/originals` and `/thumbnails`), streaming via Google's high-speed image CDN (`lh3.googleusercontent.com`).

3. **In-Browser Image Engine**:
   - Client-side image downscaling to 2048px (high-res) and 360px (thumbnails) via HTML5 Canvas.
   - Automatic EXIF orientation normalization and privacy metadata stripping (GPS coordinates) with `exifr`.
   - Native SHA-256 duplicate image detection using Web Crypto `crypto.subtle`.

4. **Real-Time Signaling & Synchronization**:
   - PubSub WebSocket broker (`wss://broker.emqx.io:8084/mqtt`) paired with `BroadcastChannel` for same-browser multi-tab sync.
   - Retained gallery broadcast (`gallery_retained`) and active request-response synchronization (`gallery_req`) ensuring late-joining guests and TV slideshows receive full approved memory streams.

5. **PWA & Offline Resilience**:
   - Service Worker (`sw.js`) with a network-first, `no-store` strategy on HTML/JS navigation requests to prevent stale cache locking.
   - IndexedDB offline queue (`offline-queue.js`) that captures guest photos offline and flushes automatically when connectivity is restored.
   - In-memory `.zip` archive generator powered by `JSZip` + `FileSaver.js`.

---

## 🛠️ Build & Development Workflow

- **Windows Build Command**: Use `cmd.exe /c "npm run build"` or `npm.cmd --prefix client run build` to avoid PowerShell script execution policy restrictions.
- **Client Dev Server**: `cmd.exe /c "npm run dev"` (Vite port 5173).
- **SPA GitHub Pages Hash Routing**: Maintain standard hash routing (`#/event/<slug>`, `#/event/<slug>/slideshow`, `#/privacy`, `#/terms`) and ensure `404.html` redirection script is preserved in `client/public/404.html`.

---

## 🚀 Mandatory Post-Deployment Verification (CRITICAL)

Whenever modifying code, compiling the client, or pushing updates to GitHub:

1. **Build & Dual Push**:
   - Compile the client: `cmd.exe /c "npm run build"`.
   - Ensure both `origin/main` and `origin/gh-pages` (or GitHub Actions artifact deployment) are in sync.
2. **Verify Live Deployment on GitHub**:
   - Check the live deployment after pushing by reading `https://deidi.github.io/event-caps/` via HTTP (`read_url_content`).
   - Confirm that the newly compiled JavaScript bundle hash (e.g. `index-[hash].js`) is actively served by GitHub Pages.
   - Confirm that remote branches (`origin/main`, `origin/gh-pages`) match local commits (`git ls-remote`).
3. **Cache Invalidation**:
   - Keep `no-store` network-first caching in `client/public/sw.js` for `.html` and `.js` requests to avoid stale browser cache locks.
