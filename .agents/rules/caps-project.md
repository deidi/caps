# EventCaps Project Rules & Guidelines

## 🌟 Core Architecture (EventCaps v2.0)

1. **100% Serverless & Cloud-First**:
   - Pure static Single Page Application (SPA) with Svelte 5 + Vite.
   - Hosted directly on **GitHub Pages** (`https://deidi.github.io/event-caps/#/`).
   - Zero backend server dependencies during runtime.
2. **Data & Storage Layer**:
   - **Local / Fallback Mode**: Client-side **IndexedDB (Dexie.js)** with SHA-256 host PIN security.
   - **Cloud Mode (100+ Attendees)**: Direct Google Drive resumable uploads & Google Cloud CDN image delivery.
3. **Real-Time Signaling**:
   - PubSub WebSocket broker (`broker.emqx.io:8084`) + local `BroadcastChannel`.
   - Uses MQTT Retained state (`gallery_retained`) and active pull (`gallery_req`) for universal synchronization.

---

## 🚀 Mandatory Post-Deployment Verification (CRITICAL)

Whenever making changes, building the client, or pushing to GitHub:

1. **Build & Dual Push**:
   - Compile the client: `npm.cmd --prefix client run build`.
   - Ensure both `origin/main` and `origin/gh-pages` are updated.
2. **Verify Live Deployment on GitHub**:
   - The agent **MUST** check the live deployment after pushing by reading `https://deidi.github.io/event-caps/` via HTTP (`read_url_content`).
   - Confirm that the newly compiled JavaScript bundle hash (e.g. `index-[hash].js`) is actively served by GitHub's CDN.
   - Confirm that remote branches (`origin/main`, `origin/gh-pages`) match local commits (`git ls-remote`).
3. **Cache Invalidation**:
   - Maintain `no-store` network-first caching in `client/public/sw.js` for all `.html` and `.js` requests to avoid stale browser cache locks.
