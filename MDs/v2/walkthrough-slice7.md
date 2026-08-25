# 🍰 Slice 7 Walkthrough — Static SPA Deployment & Offline PWA

## 🎯 Slice Objective
Finalize Caps v2 for **100% static hosting** on **GitHub Pages** and **Vercel** with full offline PWA capabilities:
1. Universal relative asset routing (`base: './'`) for subfolder repos (e.g. `https://deidi.github.io/caps/`).
2. Hash-based routing (`/#/`, `/#/event/:slug`, `/#/event/:slug/slideshow`) ensuring zero 404 errors on static web hosts.
3. Service Worker (`sw.js`) and PWA manifest (`manifest.json`) pre-caching app shell for instant offline execution.
4. `vercel.json` configured for 1-click zero-config Vercel deployment.

---

## 🛠️ Changes Implemented

1. **Vercel Deployment Configuration (`vercel.json`)**:
   - Single-page application rewrites (`/(.*) -> /index.html`) and security headers.

2. **Vite Relative Base Path & NoJekyll (`client/vite.config.js` & `client/public/.nojekyll`)**:
   - `base: './'` for universal asset resolution on GitHub Pages.
   - `.nojekyll` bypasses Jekyll processing on GitHub Pages.

3. **PWA Service Worker (`client/public/sw.js`)**:
   - `CACHE_NAME = 'caps-pwa-v2'`.
   - Pre-caches core app shell and provides stale-while-revalidate caching.

4. **Root Project Scripts (`package.json`)**:
   - `npm run dev`: Starts Vite client dev server.
   - `npm run build`: Compiles production static bundle in `client/dist/`.
   - `npm run preview`: Runs local static preview server.

---

## 🧪 Verification & How to Deploy

### Local Production Preview:
1. Build and preview static bundle:
   ```bash
   npm.cmd run build
   npm.cmd run preview
   ```
2. Open the preview URL (e.g. `http://localhost:4173/`).
3. Toggle "Offline" in DevTools Network tab; verify the app shell loads and existing IndexedDB events remain fully accessible.

### Deploy to GitHub Pages:
1. Run `npm.cmd run build`.
2. Push `client/dist/` contents to your `gh-pages` branch or configure GitHub Actions.
3. Access your live app at: `https://<your-username>.github.io/caps/#/`

### Deploy to Vercel:
1. Import repository on [Vercel](https://vercel.com).
2. Framework: Vite.
3. Build Command: `npm --prefix client run build`.
4. Output Directory: `client/dist`.
5. Deploy!

---

## 🚀 Status
- **Slice 7:** ✅ Completed & Tested.
- **Caps v2 (Server-less / Sonata Architecture):** 🎉 100% Complete!
