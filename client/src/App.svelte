<script>
  import { onMount, onDestroy } from "svelte";
  import {
    api,
    setSessionToken,
    getSessionToken,
    getGuestToken,
    setGuestToken,
    createWebSocketConnection,
    downloadSelectedZip,
    downloadFullArchiveZip,
    gdrive,
  } from "./lib/api.js";
  import {
    enqueueOfflinePhoto,
    getOfflineQueue,
    flushOfflineQueue,
  } from "./lib/offline-queue.js";
  import { db, blobToBase64, base64ToBlob } from "./lib/db.js";

  // Global app state
  let loading = $state(false);
  let errorMsg = $state("");
  let successMsg = $state("");
  let authStatus = $state({
    initialized: false,
    is_authenticated: false,
    host_name: "",
  });

  // PWA & Network State
  let isOnline = $state(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  let offlineQueueCount = $state(0);
  let isFlushingQueue = $state(false);
  let deferredInstallPrompt = $state(null);
  let showInstallButton = $state(false);

  // Route state
  let currentPath = $state(window.location.pathname);
  let isGuestRoute = $state(false);
  let isSlideshowRoute = $state(false);
  let isPrivacyRoute = $state(false);
  let isTermsRoute = $state(false);
  let currentEventSlug = $state("");

  // Host setup & unlock form state
  let setupName = $state("");
  let setupPin = $state("");
  let unlockPin = $state("");

  // Host dashboard state
  let events = $state([]);
  let isCreateModalOpen = $state(false);
  let isDeleteModalOpen = $state(false);
  let deleteConfirmInput = $state("");
  let isSubmitting = $state(false);
  let isProfileModalOpen = $state(false);
  let editHostName = $state("");
  let currentPinInput = $state("");
  let newPinInput = $state("");
  let profileErrorMsg = $state("");

  // New event form
  let newEvent = $state({
    name: "",
    date: new Date().toISOString().split("T")[0],
    tagline: "",
    moderation_enabled: true,
    guest_upload_limit: 20,
    exif_strip: false,
  });

  // Host View: 'dashboard' | 'event_detail'
  let hostView = $state("dashboard");
  let selectedEvent = $state(null);
  let hostDetailTab = $state("queue"); // 'queue' | 'gallery' | 'analytics' | 'settings'
  let pendingPhotos = $state([]);
  let approvedPhotos = $state([]);
  let eventAnalytics = $state(null);

  // QR Modal & Projection Mode
  let isQrModalOpen = $state(false);
  let isProjectionMode = $state(false);
  let qrData = $state(null);
  let qrHostType = $state("ip"); // 'ip' | 'mdns' | 'current'

  // Guest State
  let guestSession = $state(null);
  let guestNameInput = $state("");
  let guestEventData = $state(null);
  let myUploads = $state([]);
  let liveGalleryPhotos = $state([]);
  let isUploading = $state(false);
  let uploadCurrentIndex = $state(0);
  let uploadTotalCount = $state(0);
  let uploadProgressText = $state("");
  let selectedPreviewPhoto = $state(null);
  let wsConnectionStatus = $state("disconnected");

  // Multi-selection & Batch Download State
  let isSelectionMode = $state(false);
  let selectedPhotoIds = $state(new Set());
  let isDownloadingZip = $state(false);

  // Slideshow / TV Mode State
  let slideshowPhotos = $state([]);
  let currentSlideIndex = $state(0);
  let isSlideshowPaused = $state(false);
  let slideshowConfig = $state({
    interval: 5,
    transition: "fade",
    show_qr: true,
    show_author: true,
    qr_data_url: "",
    join_url: "",
  });
  let slideshowTimer = null;

  // DOM file input references
  let cameraInputEl = $state();
  let fileInputEl = $state();

  let wsHandle = null;

  function parseRoute() {
    let path = window.location.pathname;

    // Strip out base repo directory if present in pathname
    if (path.includes("/event/")) {
      path = path.substring(path.indexOf("/event/"));
    }

    if (window.location.hash && window.location.hash.startsWith("#")) {
      const hashPart = window.location.hash.substring(1);
      if (hashPart.startsWith("/")) {
        path = hashPart;
      }
    }
    currentPath = path;

    if (path === "/privacy" || path.startsWith("/privacy")) {
      isPrivacyRoute = true;
      isTermsRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    if (path === "/terms" || path.startsWith("/terms")) {
      isTermsRoute = true;
      isPrivacyRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    isPrivacyRoute = false;
    isTermsRoute = false;

    const slideshowMatch = path.match(
      /^\/event\/([a-zA-Z0-9_-]+)\/(slideshow|tv)/,
    );
    if (slideshowMatch) {
      isSlideshowRoute = true;
      isGuestRoute = false;
      currentEventSlug = slideshowMatch[1];
      return;
    }

    const eventMatch = path.match(/^\/event\/([a-zA-Z0-9_-]+)/);
    if (eventMatch) {
      isGuestRoute = true;
      isSlideshowRoute = false;
      currentEventSlug = eventMatch[1];
      return;
    }

    isGuestRoute = false;
    isSlideshowRoute = false;
    currentEventSlug = "";
  }

  function navigate(url) {
    const cleanUrl = url.startsWith("/") ? url : `/${url}`;
    window.location.hash = `#${cleanUrl}`;
    parseRoute();
    initView();
  }

  async function initView() {
    errorMsg = "";
    successMsg = "";
    isSelectionMode = false;
    selectedPhotoIds = new Set();
    parseRoute();

    if (wsHandle) {
      try {
        wsHandle.disconnect();
      } catch (e) {}
      wsHandle = null;
    }

    try {
      if (isSlideshowRoute && currentEventSlug) {
        await loadSlideshowExperience(currentEventSlug);
        setupWebSocket(currentEventSlug, false);
      } else if (isGuestRoute && currentEventSlug) {
        await loadGuestExperience(currentEventSlug);
        setupWebSocket(currentEventSlug, false);
      } else {
        await checkAuth();
      }
    } catch (err) {
      console.error("InitView error:", err);
      errorMsg = err.message || "Failed to load event";
    } finally {
      loading = false;
    }
  }

  function setupWebSocket(slug, isHost = false) {
    if (!slug) return;
    try {
      wsHandle = createWebSocketConnection(slug, {
        isHost,
        onStatusChange: (status) => {
          wsConnectionStatus = status;
        },
        onMessage: (msg) => {
          handleWebSocketMessage(msg);
        },
      });
    } catch (err) {
      console.warn("P2P Mesh initialization skipped or failed:", err);
    }
  }

  function handleWebSocketMessage(msg) {
    if (msg.type === "event:status-changed") {
      if (guestEventData && guestEventData.slug === msg.payload.slug) {
        guestEventData.status = msg.payload.status;
      }
      if (selectedEvent && selectedEvent.slug === msg.payload.slug) {
        selectedEvent.status = msg.payload.status;
      }
    } else if (msg.type === "event:settings-updated") {
      const targetSlug = msg.payload.slug || (guestEventData && guestEventData.slug) || (selectedEvent && selectedEvent.slug);
      if (msg.payload.event_settings) {
        const settings = msg.payload.event_settings;
        if (guestEventData && (!msg.payload.slug || guestEventData.slug === msg.payload.slug)) {
          guestEventData = { ...guestEventData, ...settings };
          if (guestSession) {
            const limit = Number(settings.guest_upload_limit) || 20;
            const used = Number(guestSession.guest?.upload_count) || 0;
            guestSession.event = { ...guestSession.event, ...settings };
            guestSession.quota = {
              used,
              limit,
              remaining: Math.max(0, limit - used),
            };
          }
        }
        if (selectedEvent && (!msg.payload.slug || selectedEvent.slug === msg.payload.slug)) {
          selectedEvent = { ...selectedEvent, ...settings };
        }
        if (targetSlug) {
          db.events.where("slug").equals(targetSlug).modify({
            guest_upload_limit: Number(settings.guest_upload_limit) || 20,
            moderation_enabled: Boolean(settings.moderation_enabled),
            name: settings.name,
            tagline: settings.tagline
          }).catch(() => {});
        }
      }
    } else if (msg.type === "event:deleted") {
      if (
        (guestEventData && guestEventData.slug === msg.payload.slug) ||
        (selectedEvent && selectedEvent.slug === msg.payload.slug)
      ) {
        alert("This event has been deleted by the host.");
        navigate("/");
      }
    }

    if (isSlideshowRoute) {
      if (msg.type === "photo:approved") {
        const photo = msg.payload;
        if (
          !slideshowPhotos.some(
            (p) => (p.hash && p.hash === photo.hash) || p.id === photo.id,
          )
        ) {
          slideshowPhotos = [...slideshowPhotos, photo];
        }
      } else if (msg.type === "photo:bulk-approved") {
        const newlyApproved = msg.payload.photos || [];
        const existingHashes = new Set(
          slideshowPhotos.map((p) => p.hash).filter(Boolean),
        );
        const existingIds = new Set(slideshowPhotos.map((p) => p.id));
        const toAdd = newlyApproved.filter(
          (p) => !existingHashes.has(p.hash) && !existingIds.has(p.id),
        );
        slideshowPhotos = [...slideshowPhotos, ...toAdd];
      } else if (msg.type === "gallery:synced") {
        const syncedPhotos = msg.payload.photos || [];
        const syncedHashes = new Set(syncedPhotos.map((p) => p.hash).filter(Boolean));
        const syncedIds = new Set(syncedPhotos.map((p) => p.id).filter(Boolean));

        // Prune any photo no longer in syncedPhotos
        slideshowPhotos = slideshowPhotos.filter(
          (p) => (p.hash && syncedHashes.has(p.hash)) || (p.id && syncedIds.has(p.id)),
        );

        for (const photo of syncedPhotos) {
          if (
            !slideshowPhotos.some(
              (p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id),
            )
          ) {
            const thumbUrl = photo.thumb_url || photo.drive_thumb_url || photo.original_url || photo.drive_orig_url || (photo.thumbDataUrl ? URL.createObjectURL(base64ToBlob(photo.thumbDataUrl)) : "");
            const origUrl = photo.original_url || photo.drive_orig_url || thumbUrl;
            if (thumbUrl || origUrl) {
              slideshowPhotos = [
                ...slideshowPhotos,
                {
                  ...photo,
                  thumbnail_path: thumbUrl,
                  thumb_url: thumbUrl,
                  original_path: origUrl,
                  original_url: origUrl,
                },
              ];
            }
          }
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload.id;
        const removeHash = msg.payload.hash;
        slideshowPhotos = slideshowPhotos.filter(
          (p) => p.id !== removeId && (!removeHash || p.hash !== removeHash),
        );
        if (currentSlideIndex >= slideshowPhotos.length) {
          currentSlideIndex = Math.max(0, slideshowPhotos.length - 1);
        }
      }
    } else if (isGuestRoute) {
      if (msg.type === "photo:approved") {
        const photo = msg.payload;
        // 1. Update status in myUploads
        myUploads = myUploads.map((p) =>
          ((p.hash && p.hash === photo.hash) || p.id === photo.id || p.filename === photo.filename)
            ? { ...p, status: "approved" }
            : p,
        );

        // 2. Update status in Guest IndexedDB
        if (photo.hash) {
          db.photos
            .where("hash")
            .equals(photo.hash)
            .modify({ status: "approved" })
            .catch(() => {});
        }

        // 3. Find or construct the photo object with valid image URL
        const localMatch = myUploads.find((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id || p.filename === photo.filename);
        const thumbUrl = photo.thumb_url || photo.drive_thumb_url || photo.original_url || photo.drive_orig_url || (localMatch ? localMatch.thumb_url : "");
        const origUrl = photo.original_url || photo.drive_orig_url || thumbUrl || (localMatch ? localMatch.original_url : "");

        let galleryItem = null;
        if (localMatch) {
          galleryItem = { ...localMatch, status: "approved", thumb_url: thumbUrl || localMatch.thumb_url, original_url: origUrl || localMatch.original_url, thumbnail_path: thumbUrl || localMatch.thumbnail_path, original_path: origUrl || localMatch.original_path };
        } else {
          galleryItem = {
            ...photo,
            status: "approved",
            thumb_url: thumbUrl,
            original_url: origUrl,
            thumbnail_path: thumbUrl,
            original_path: origUrl,
          };
        }

        // 4. Update liveGalleryPhotos reactively
        if (
          !liveGalleryPhotos.some(
            (p) => (p.hash && p.hash === photo.hash) || p.id === photo.id,
          )
        ) {
          liveGalleryPhotos = [galleryItem, ...liveGalleryPhotos];
        } else {
          liveGalleryPhotos = liveGalleryPhotos.map((p) =>
            ((p.hash && p.hash === photo.hash) || p.id === photo.id)
              ? { ...p, ...galleryItem, status: "approved" }
              : p,
          );
        }
      } else if (msg.type === "gallery:synced") {
        if (msg.payload.event_settings) {
          const settings = msg.payload.event_settings;
          if (guestEventData) {
            guestEventData = { ...guestEventData, ...settings };
          }
          if (guestSession) {
            const limit = Number(settings.guest_upload_limit) || 20;
            const used = Number(guestSession.guest?.upload_count) || 0;
            guestSession.event = { ...guestSession.event, ...settings };
            guestSession.quota = {
              used,
              limit,
              remaining: Math.max(0, limit - used),
            };
          }
          if (currentEventSlug) {
            db.events.where("slug").equals(currentEventSlug).modify({
              guest_upload_limit: Number(settings.guest_upload_limit) || 20,
              moderation_enabled: Boolean(settings.moderation_enabled),
              name: settings.name,
              tagline: settings.tagline
            }).catch(() => {});
          }
        }

        const syncedPhotos = msg.payload.photos || [];
        const syncedHashes = new Set(syncedPhotos.map((p) => p.hash).filter(Boolean));
        const syncedIds = new Set(syncedPhotos.map((p) => p.id).filter(Boolean));

        // Prune any photo no longer in syncedPhotos from live gallery
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => (p.hash && syncedHashes.has(p.hash)) || (p.id && syncedIds.has(p.id)),
        );

        for (const photo of syncedPhotos) {
          if (
            !liveGalleryPhotos.some(
              (p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id),
            )
          ) {
            const localMatch = myUploads.find((p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id));
            if (localMatch) {
              liveGalleryPhotos = [
                ...liveGalleryPhotos,
                { ...localMatch, status: "approved" },
              ];
            } else {
              const thumbUrl = photo.thumb_url || photo.drive_thumb_url || photo.original_url || photo.drive_orig_url || (photo.thumbDataUrl ? URL.createObjectURL(base64ToBlob(photo.thumbDataUrl)) : "");
              const origUrl = photo.original_url || photo.drive_orig_url || thumbUrl;
              if (thumbUrl || origUrl) {
                liveGalleryPhotos = [
                  ...liveGalleryPhotos,
                  {
                    ...photo,
                    status: "approved",
                    thumbnail_path: thumbUrl,
                    thumb_url: thumbUrl,
                    original_path: origUrl,
                    original_url: origUrl,
                  },
                ];
              }
            }
          }
        }
      } else if (msg.type === "photo:bulk-approved") {
        const newApproved = msg.payload.photos || [];
        const approvedHashes = new Set(
          newApproved.map((p) => p.hash).filter(Boolean),
        );
        const approvedIds = new Set(newApproved.map((p) => p.id));

        myUploads = myUploads.map((p) =>
          approvedHashes.has(p.hash) || approvedIds.has(p.id)
            ? { ...p, status: "approved" }
            : p,
        );

        for (const hash of approvedHashes) {
          db.photos
            .where("hash")
            .equals(hash)
            .modify({ status: "approved" })
            .catch(() => {});
        }

        const existingHashes = new Set(
          liveGalleryPhotos.map((p) => p.hash).filter(Boolean),
        );
        const existingIds = new Set(liveGalleryPhotos.map((p) => p.id));

        for (const photo of newApproved) {
          if (!existingHashes.has(photo.hash) && !existingIds.has(photo.id)) {
            const localMatch = myUploads.find((p) => p.hash === photo.hash);
            if (localMatch) {
              liveGalleryPhotos = [
                ...liveGalleryPhotos,
                { ...localMatch, status: "approved" },
              ];
            } else {
              const thumbUrl = photo.thumb_url || photo.drive_thumb_url || photo.original_url || photo.drive_orig_url || (photo.thumbDataUrl ? URL.createObjectURL(base64ToBlob(photo.thumbDataUrl)) : "");
              const origUrl = photo.original_url || photo.drive_orig_url || thumbUrl;
              if (thumbUrl || origUrl) {
                liveGalleryPhotos = [
                  ...liveGalleryPhotos,
                  {
                    ...photo,
                    status: "approved",
                    thumbnail_path: thumbUrl,
                    thumb_url: thumbUrl,
                    original_path: origUrl,
                    original_url: origUrl,
                  },
                ];
              }
            }
          }
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload.id;
        const removeHash = msg.payload.hash;
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => (removeId && p.id === removeId) || (removeHash && p.hash === removeHash) ? false : true,
        );
        if (msg.type === "photo:deleted") {
          myUploads = myUploads.filter(
            (p) => (removeId && p.id === removeId) || (removeHash && p.hash === removeHash) ? false : true,
          );
        } else if (msg.type === "photo:removed") {
          myUploads = myUploads.map((p) =>
            (removeId && p.id === removeId) || (removeHash && p.hash === removeHash)
              ? { ...p, status: "pending" }
              : p,
          );
        }
        if (removeHash) {
          db.photos
            .where("hash")
            .equals(removeHash)
            .modify({ status: msg.type === "photo:deleted" ? "rejected" : "pending" })
            .catch(() => {});
        }
        if (selectedPhotoIds.has(removeId)) {
          selectedPhotoIds.delete(removeId);
          selectedPhotoIds = new Set(selectedPhotoIds);
        }
      } else if (msg.type === "photo:bulk-removed") {
        const removedIds = new Set(msg.payload.ids || []);
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => !removedIds.has(p.id),
        );
        myUploads = myUploads.map((p) =>
          removedIds.has(p.id) ? { ...p, status: "pending" } : p
        );
      }
    } else if (selectedEvent) {
      if (msg.type === "photo:new-pending" || msg.type === "photo:uploaded") {
        const photo = msg.payload.photo || msg.payload;
        if (photo.status === "pending") {
          if (!pendingPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
            pendingPhotos = [photo, ...pendingPhotos];
          }
        } else if (photo.status === "approved") {
          pendingPhotos = pendingPhotos.filter((p) => (p.hash && p.hash === photo.hash) ? false : p.id !== photo.id);
          if (!approvedPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
            approvedPhotos = [photo, ...approvedPhotos];
          }
        }
      } else if (msg.type === "photo:approved") {
        const photo = msg.payload.photo || msg.payload;
        pendingPhotos = pendingPhotos.filter((p) => (p.hash && p.hash === photo.hash) ? false : p.id !== photo.id);
        if (!approvedPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
          approvedPhotos = [photo, ...approvedPhotos];
        }
      } else if (msg.type === "photo:status-changed") {
        const photo = msg.payload.photo;
        if (photo) {
          if (photo.status === "pending") {
            approvedPhotos = approvedPhotos.filter((p) => p.id !== photo.id);
            if (!pendingPhotos.some((p) => p.id === photo.id)) {
              pendingPhotos = [{ ...photo }, ...pendingPhotos];
            }
          } else if (photo.status === "approved") {
            pendingPhotos = pendingPhotos.filter((p) => p.id !== photo.id);
            if (!approvedPhotos.some((p) => p.id === photo.id)) {
              approvedPhotos = [{ ...photo }, ...approvedPhotos];
            }
          } else if (photo.status === "rejected") {
            pendingPhotos = pendingPhotos.filter((p) => p.id !== photo.id);
            approvedPhotos = approvedPhotos.filter((p) => p.id !== photo.id);
          }
        }
      } else if (msg.type === "photo:bulk-status-changed") {
        const { status, ids } = msg.payload || {};
        const idSet = new Set(ids || []);
        if (status === "pending") {
          const toMove = approvedPhotos
            .filter((p) => idSet.has(p.id))
            .map((p) => ({ ...p, status: "pending" }));
          approvedPhotos = approvedPhotos.filter((p) => !idSet.has(p.id));
          const existingPendingIds = new Set(pendingPhotos.map((p) => p.id));
          const newlyPending = toMove.filter(
            (p) => !existingPendingIds.has(p.id),
          );
          pendingPhotos = [...newlyPending, ...pendingPhotos];
        } else if (status === "approved") {
          const toMove = pendingPhotos
            .filter((p) => idSet.has(p.id))
            .map((p) => ({ ...p, status: "approved" }));
          pendingPhotos = pendingPhotos.filter((p) => !idSet.has(p.id));
          const existingApprovedIds = new Set(approvedPhotos.map((p) => p.id));
          const newlyApproved = toMove.filter(
            (p) => !existingApprovedIds.has(p.id),
          );
          approvedPhotos = [...newlyApproved, ...approvedPhotos];
        } else if (status === "rejected") {
          pendingPhotos = pendingPhotos.filter((p) => !idSet.has(p.id));
          approvedPhotos = approvedPhotos.filter((p) => !idSet.has(p.id));
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload?.id;
        const removeHash = msg.payload?.hash;
        const removeFilename = msg.payload?.filename;
        const targetSlug = msg.payload?.event_slug || selectedEvent?.slug;

        // 1. Remove from Host active UI state
        approvedPhotos = approvedPhotos.filter(
          (p) => (removeId && (p.id == removeId || p.id === removeId)) ||
                 (removeHash && p.hash && p.hash === removeHash) ||
                 (removeFilename && p.filename && p.filename === removeFilename)
                 ? false : true,
        );
        pendingPhotos = pendingPhotos.filter(
          (p) => (removeId && (p.id == removeId || p.id === removeId)) ||
                 (removeHash && p.hash && p.hash === removeHash) ||
                 (removeFilename && p.filename && p.filename === removeFilename)
                 ? false : true,
        );

        // 2. Remove/mark deleted in Host IndexedDB
        if (removeHash) {
          db.photos.where("hash").equals(removeHash).delete().catch(() => {});
        }
        if (removeFilename && targetSlug) {
          db.photos.where({ event_slug: targetSlug, filename: removeFilename }).delete().catch(() => {});
        }
        if (removeId && !isNaN(parseInt(removeId, 10))) {
          db.photos.delete(parseInt(removeId, 10)).catch(() => {});
        }

        // 3. Decrement guest upload count in Host DB if guest_token is present
        if (msg.payload?.guest_token) {
          db.guests.where("token").equals(msg.payload.guest_token).modify(g => {
            g.upload_count = Math.max(0, (g.upload_count || 1) - 1);
          }).catch(() => {});
        }

        // 4. Update Host events / analytics counters
        loadEvents().catch(() => {});
        if (selectedEvent?.slug) {
          loadAnalytics(selectedEvent.slug).catch(() => {});
        }

        // 5. Re-broadcast the updated approved gallery so MQTT retained state & all devices update
        if (wsHandle && typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
    }
  }

  // --- HOST LOGIC ---
  async function checkAuth() {
    try {
      const res = await api.getAuthStatus();
      authStatus = res;
      if (res.is_authenticated) {
        await loadEvents();
      }
    } catch (err) {
      errorMsg = err.message || "Failed to connect to server";
    }
  }

  async function handleSetup(e) {
    e.preventDefault();
    if (!setupName.trim() || !setupPin.trim()) return;
    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.setupHost(setupName, setupPin);
      setSessionToken(res.session_token);
      authStatus = {
        initialized: true,
        is_authenticated: true,
        host_name: res.host_name,
      };
      await loadEvents();
    } catch (err) {
      errorMsg = err.message || "Setup failed";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleUnlock(e) {
    e.preventDefault();
    if (!unlockPin.trim()) return;
    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.verifyPin(unlockPin);
      setSessionToken(res.session_token);
      authStatus = {
        initialized: true,
        is_authenticated: true,
        host_name: res.host_name,
      };
      unlockPin = "";
      await loadEvents();
    } catch (err) {
      errorMsg = err.message || "Invalid PIN";
    } finally {
      isSubmitting = false;
    }
  }

  function handleLogout() {
    setSessionToken("");
    authStatus.is_authenticated = false;
    hostView = "dashboard";
    selectedEvent = null;
    if (wsHandle) {
      wsHandle.disconnect();
      wsHandle = null;
    }
  }

  function openProfileModal() {
    editHostName = authStatus.host_name || "";
    currentPinInput = "";
    newPinInput = "";
    profileErrorMsg = "";
    isProfileModalOpen = true;
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    if (!editHostName.trim()) return;
    isSubmitting = true;
    profileErrorMsg = "";
    try {
      const res = await api.updateHostProfile({
        host_name: editHostName.trim(),
        current_pin: currentPinInput.trim() || undefined,
        new_pin: newPinInput.trim() || undefined,
      });
      authStatus.host_name = res.host_name;
      isProfileModalOpen = false;
      successMsg = "Host profile and PIN updated successfully!";
      setTimeout(() => (successMsg = ""), 3500);
    } catch (err) {
      profileErrorMsg = err.message || "Failed to update profile";
    } finally {
      isSubmitting = false;
    }
  }

  async function loadEvents() {
    try {
      const res = await api.getEvents();
      events = res.events || [];
    } catch (err) {
      console.error("Failed to load events", err);
    }
  }

  async function handleCreateEvent(e) {
    e.preventDefault();
    if (!newEvent.name.trim()) return;
    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.createEvent({
        name: newEvent.name,
        date: newEvent.date,
        tagline: newEvent.tagline,
        moderation_enabled: newEvent.moderation_enabled ? 1 : 0,
        guest_upload_limit: Number(newEvent.guest_upload_limit) || 20,
        exif_strip: newEvent.exif_strip ? 1 : 0,
      });

      isCreateModalOpen = false;
      newEvent = {
        name: "",
        date: new Date().toISOString().split("T")[0],
        tagline: "",
        moderation_enabled: true,
        guest_upload_limit: 20,
        exif_strip: false,
      };
      await loadEvents();
      if (res.event) {
        await viewEvent(res.event);
      }
    } catch (err) {
      errorMsg = err.message || "Failed to create event";
    } finally {
      isSubmitting = false;
    }
  }

  async function viewEvent(event) {
    selectedEvent = event;
    hostView = "event_detail";
    hostDetailTab = "queue";
    await loadHostEventPhotos(event.slug);
    setupWebSocket(event.slug, true);
  }

  async function loadHostEventPhotos(slug) {
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        api.getPhotos(slug, { status: "pending" }),
        api.getPhotos(slug, { status: "approved" }),
      ]);
      pendingPhotos = pendingRes.photos || [];
      approvedPhotos = approvedRes.photos || [];
    } catch (err) {
      console.error("Failed to load event photos for host", err);
    }
  }

  async function loadAnalytics(slug) {
    if (!slug) return;
    try {
      const res = await api.getEventAnalytics(slug);
      eventAnalytics = res.analytics;
    } catch (err) {
      console.error("Failed to load event analytics", err);
      eventAnalytics = {
        total_photos: (pendingPhotos?.length || 0) + (approvedPhotos?.length || 0),
        approved: approvedPhotos?.length || 0,
        pending: pendingPhotos?.length || 0,
        rejected: 0,
        unique_guests: 1,
        storage_used_mb: "0.00",
        top_contributors: [],
        uploads_over_time: []
      };
    }
  }

  async function handleToggleEventStatus() {
    if (!selectedEvent) return;
    const newStatus = selectedEvent.status === "active" ? "archived" : "active";
    const actionText = newStatus === "archived" ? "Close & Archive" : "Reopen";
    if (
      !confirm(
        `${actionText} event "${selectedEvent.name}"? ${newStatus === "archived" ? "Guest uploads will be disabled." : "Guest uploads will be re-enabled."}`,
      )
    )
      return;

    try {
      const res = await api.updateEventStatus(selectedEvent.slug, newStatus);
      selectedEvent = { ...selectedEvent, status: newStatus };
      successMsg = res.message || `Event status updated to ${newStatus}`;
      setTimeout(() => (successMsg = ""), 3500);

      // Real-time broadcast status change to guest phones and TV slideshow
      if (wsHandle) {
        wsHandle.send({
          type: "event:status-changed",
          payload: { slug: selectedEvent.slug, status: newStatus }
        });
        if (typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to update event status: " + err.message);
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent || deleteConfirmInput !== selectedEvent.name) return;
    isSubmitting = true;
    try {
      await api.deleteEvent(selectedEvent.slug);
      isDeleteModalOpen = false;
      deleteConfirmInput = "";
      selectedEvent = null;
      hostView = "dashboard";
      await loadEvents();
    } catch (err) {
      alert("Failed to delete event: " + err.message);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleApprovePhoto(photoId) {
    try {
      await api.patchPhotoStatus(selectedEvent.slug, photoId, "approved");
      const photo = pendingPhotos.find((p) => p.id === photoId);
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      if (photo) {
        const approvedItem = { ...photo, status: "approved" };
        approvedPhotos = [approvedItem, ...approvedPhotos];
        if (wsHandle) {
          const dbRecord = await db.photos.get(photoId);
          let thumbDataUrl = photo.thumbDataUrl;
          if (!thumbDataUrl && dbRecord?.thumb_blob) {
            thumbDataUrl = await blobToBase64(dbRecord.thumb_blob);
          }

          wsHandle.send({
            type: "photo:approved",
            payload: {
              id: approvedItem.id,
              hash: approvedItem.hash,
              event_slug: approvedItem.event_slug,
              guest_name: approvedItem.guest_name,
              status: "approved",
              created_at: approvedItem.created_at,
              filename: approvedItem.filename,
              thumbDataUrl,
            },
          });
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to approve photo: " + err.message);
    }
  }

  async function handleToggleAutoApprove() {
    if (!selectedEvent) return;
    const newModState = !selectedEvent.moderation_enabled;
    const isAutoNow = !newModState;

    try {
      await api.updateEvent(selectedEvent.slug, {
        moderation_enabled: newModState
      });

      selectedEvent = { ...selectedEvent, moderation_enabled: newModState };

      if (isAutoNow) {
        successMsg = "⚡ Auto-Approve enabled! All new guest uploads will stream live immediately.";
        if (pendingPhotos.length > 0) {
          if (confirm(`Auto-Approve is now ON! Would you like to approve the ${pendingPhotos.length} photo(s) currently waiting in queue?`)) {
            await handleBulkApprove();
          }
        }
      } else {
        successMsg = "🛡️ Manual moderation enabled! New photos will wait for your review in this queue.";
      }
      setTimeout(() => (successMsg = ""), 4500);

      // Real-time broadcast updated settings to all guest devices and slideshows
      if (wsHandle) {
        wsHandle.send({
          type: "event:settings-updated",
          payload: {
            slug: selectedEvent.slug,
            event_settings: {
              moderation_enabled: newModState,
              name: selectedEvent.name,
              tagline: selectedEvent.tagline,
              guest_upload_limit: selectedEvent.guest_upload_limit
            }
          }
        });
        if (typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to toggle moderation mode: " + err.message);
    }
  }

  async function handleRejectPhoto(photoId) {
    try {
      const photo = pendingPhotos.find((p) => p.id === photoId);
      await api.patchPhotoStatus(selectedEvent.slug, photoId, "rejected");
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: { id: photoId, hash: photo?.hash },
        });
        wsHandle.broadcastGallery();
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to reject photo: " + err.message);
    }
  }

  async function handleRevertPhoto(photoId) {
    try {
      const res = await api.patchPhotoStatus(
        selectedEvent.slug,
        photoId,
        "pending",
      );
      const photo =
        (res && res.photo) || approvedPhotos.find((p) => p.id === photoId);
      approvedPhotos = approvedPhotos.filter((p) => p.id !== photoId);
      if (photo) {
        const revertedItem = { ...photo, status: "pending" };
        pendingPhotos = [
          revertedItem,
          ...pendingPhotos.filter((p) => p.id !== photoId),
        ];
        if (wsHandle) {
          wsHandle.send({
            type: "photo:removed",
            payload: { id: photoId, hash: photo?.hash },
          });
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to revert photo: " + err.message);
    }
  }

  async function handleDeleteLivePhoto(photoId) {
    if (!confirm("Permanently remove and reject this photo?")) return;
    try {
      const photo = approvedPhotos.find((p) => p.id === photoId) || pendingPhotos.find((p) => p.id === photoId);
      await api.patchPhotoStatus(selectedEvent.slug, photoId, "rejected");
      approvedPhotos = approvedPhotos.filter((p) => p.id !== photoId);
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: { id: photoId, hash: photo?.hash },
        });
        wsHandle.broadcastGallery();
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to delete photo: " + err.message);
    }
  }

  async function handleBulkApprove() {
    if (!pendingPhotos.length) return;
    const ids = pendingPhotos.map((p) => p.id);
    try {
      await api.bulkPatchPhotoStatus(selectedEvent.slug, ids, "approved");
      const newlyApproved = [];
      for (const p of pendingPhotos) {
        let thumbDataUrl = p.thumbDataUrl;
        if (!thumbDataUrl) {
          const dbRecord = await db.photos.get(p.id);
          if (dbRecord?.thumb_blob) {
            thumbDataUrl = await blobToBase64(dbRecord.thumb_blob);
          }
        }
        newlyApproved.push({
          ...p,
          status: "approved",
          thumbDataUrl,
        });
      }
      approvedPhotos = [...newlyApproved, ...approvedPhotos];
      pendingPhotos = [];
      if (wsHandle && newlyApproved.length > 0) {
        wsHandle.send({
          type: "photo:bulk-approved",
          payload: { photos: newlyApproved },
        });
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to bulk approve: " + err.message);
    }
  }

  async function handleBulkReject() {
    if (!pendingPhotos.length) return;
    if (!confirm(`Reject all ${pendingPhotos.length} pending photos?`)) return;
    const ids = pendingPhotos.map((p) => p.id);
    try {
      await api.bulkPatchPhotoStatus(selectedEvent.slug, ids, "rejected");
      pendingPhotos = [];
      if (wsHandle) {
        wsHandle.send({
          type: "photo:bulk-removed",
          payload: { ids },
        });
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to bulk reject: " + err.message);
    }
  }

  // --- GOOGLE DRIVE BACKUP & ZIP EXPORTS (Client-Side Storage) ---
  let gdriveClientId = $state(
    localStorage.getItem("caps_gdrive_client_id") || "",
  );
  let isDriveConnected = $state(Boolean(gdrive.getStoredDriveToken()));
  let isSyncingDrive = $state(false);
  let driveSyncProgress = $state("");
  let driveEventFolderUrl = $state("");

  async function handleConnectGoogleDrive() {
    let clientId = gdriveClientId.trim();
    if (!clientId) {
      const inputId = prompt(
        "Enter your Google OAuth 2.0 Client ID (from Google Cloud Console):",
        "",
      );
      if (!inputId || !inputId.trim()) return;
      clientId = inputId.trim();
      gdriveClientId = clientId;
      localStorage.setItem("caps_gdrive_client_id", clientId);
    }
    try {
      await gdrive.requestGoogleDriveAuth(clientId);
      isDriveConnected = true;
      if (selectedEvent) {
        try {
          const hierarchy = await gdrive.setupEventDriveHierarchy(selectedEvent.slug, selectedEvent.name);
          driveEventFolderUrl = hierarchy.folderUrl;
        } catch (e) {
          console.warn("Could not pre-initialize Drive hierarchy:", e);
        }
      }
      successMsg = "Connected to Google Drive! Direct 100+ guest uploads active.";
      setTimeout(() => (successMsg = ""), 4000);
    } catch (err) {
      alert("Google Drive connection failed: " + err.message);
    }
  }

  function handleDisconnectGoogleDrive() {
    gdrive.disconnectGoogleDrive();
    isDriveConnected = false;
    driveEventFolderUrl = "";
    successMsg = "Disconnected from Google Drive.";
    setTimeout(() => (successMsg = ""), 3000);
  }

  async function handleSyncToGoogleDrive(slug) {
    if (!isDriveConnected) {
      await handleConnectGoogleDrive();
      if (!isDriveConnected) return;
    }
    isSyncingDrive = true;
    driveSyncProgress = "Starting Google Drive sync...";
    try {
      const res = await gdrive.syncEventToGoogleDrive(slug, (p) => {
        driveSyncProgress = p.message || `Syncing ${p.percent || 0}%...`;
      });
      if (res.folder_url) {
        driveEventFolderUrl = res.folder_url;
      }
      successMsg = `Successfully synced ${res.synced_count} photos to Google Drive!`;
      setTimeout(() => (successMsg = ""), 5000);
    } catch (err) {
      alert("Google Drive sync failed: " + err.message);
    } finally {
      isSyncingDrive = false;
      driveSyncProgress = "";
    }
  }

  let isExportingArchive = $state(false);
  async function handleExportFullArchive(slug) {
    isExportingArchive = true;
    try {
      await downloadFullArchiveZip(slug, (p) => {
        uploadProgressText = p.message || `Generating archive...`;
      });
      successMsg = "Full archive downloaded!";
      setTimeout(() => (successMsg = ""), 4000);
    } catch (err) {
      alert("Failed to export archive: " + err.message);
    } finally {
      isExportingArchive = false;
      uploadProgressText = "";
    }
  }

  async function handleSaveSlideshowConfig() {
    if (!selectedEvent) return;
    try {
      await api.updateSlideshowConfig(selectedEvent.slug, {
        interval: selectedEvent.slideshow_interval,
        transition: selectedEvent.slideshow_transition,
        show_qr: selectedEvent.slideshow_show_qr,
        show_author: selectedEvent.slideshow_show_author,
      });
      successMsg = "Slideshow settings saved!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to save slideshow settings: " + err.message);
    }
  }

  let logoFileInputEl = $state();
  let isUploadingLogo = $state(false);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !selectedEvent) return;
    isUploadingLogo = true;
    try {
      const res = await api.uploadEventLogo(selectedEvent.slug, file);
      selectedEvent.logo = res.logo;
      successMsg = "Event logo uploaded successfully!";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to upload logo: " + err.message);
    } finally {
      isUploadingLogo = false;
      e.target.value = "";
    }
  }

  async function handleRemoveLogo() {
    if (!selectedEvent || !confirm("Remove custom logo from this event?"))
      return;
    try {
      await api.deleteEventLogo(selectedEvent.slug);
      selectedEvent.logo = null;
      successMsg = "Event logo removed.";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to remove logo: " + err.message);
    }
  }

  async function handleSaveBranding() {
    if (!selectedEvent) return;
    try {
      await api.updateEventBranding(selectedEvent.slug, {
        tagline: selectedEvent.tagline,
        primary_color: selectedEvent.primary_color,
      });
      successMsg = "Event branding updated!";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to save branding: " + err.message);
    }
  }

  async function handleSaveEventSettings() {
    if (!selectedEvent) return;
    try {
      const res = await api.updateEvent(selectedEvent.slug, {
        name: selectedEvent.name,
        tagline: selectedEvent.tagline,
        guest_upload_limit: Number(selectedEvent.guest_upload_limit) || 20,
        moderation_enabled: selectedEvent.moderation_enabled,
        exif_strip: selectedEvent.exif_strip,
      });
      selectedEvent = { ...selectedEvent, ...res.event };
      successMsg = "Event settings & upload limit saved successfully!";
      setTimeout(() => (successMsg = ""), 3000);

      if (wsHandle) {
        wsHandle.send({
          type: "event:settings-updated",
          payload: {
            slug: selectedEvent.slug,
            event_settings: {
              name: selectedEvent.name,
              tagline: selectedEvent.tagline,
              guest_upload_limit: selectedEvent.guest_upload_limit,
              moderation_enabled: selectedEvent.moderation_enabled,
              status: selectedEvent.status,
            },
          },
        });
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to save event settings: " + err.message);
    }
  }

  async function openQrModal(event, projection = false) {
    selectedEvent = event;
    isProjectionMode = projection;
    isQrModalOpen = true;
    await fetchQrData();
  }

  async function fetchQrData() {
    if (!selectedEvent) return;
    try {
      qrData = await api.getEventQR(selectedEvent.slug, qrHostType);
    } catch (err) {
      console.error("Failed to fetch QR", err);
    }
  }

  // --- GUEST LOGIC ---
  async function loadGuestExperience(slug) {
    try {
      const eventRes = await api.getEvent(slug);
      guestEventData = eventRes.event;

      const galleryRes = await api.getPhotos(slug, { status: "approved" });
      liveGalleryPhotos = galleryRes.photos || [];

      const existingToken = getGuestToken(slug);
      if (existingToken) {
        try {
          const session = await api.getGuestSession(slug, existingToken);
          if (session && session.guest) {
            const eventObj = session.event ||
              guestEventData || { guest_upload_limit: 20 };
            const limit = Number(eventObj.guest_upload_limit) || 20;
            const used = Number(session.guest.upload_count) || 0;
            guestSession = {
              guest: session.guest,
              event: eventObj,
              quota: session.quota || {
                used,
                limit,
                remaining: Math.max(0, limit - used),
              },
            };
            await loadMyUploads(slug, existingToken);
          } else {
            setGuestToken(slug, "");
            guestSession = null;
          }
        } catch {
          setGuestToken(slug, "");
          guestSession = null;
        }
      } else {
        guestSession = null;
      }
    } catch (err) {
      console.error("loadGuestExperience error:", err);
      errorMsg = err.message || "Event space not found";
    }
  }

  async function loadMyUploads(slug, token) {
    try {
      const res = await api.getPhotos(slug, { guest: "me", guestToken: token });
      myUploads = res.photos || [];
    } catch (err) {
      console.error("Failed to load guest uploads", err);
    }
  }

  async function handleGuestJoin(e) {
    e.preventDefault();
    if (!guestNameInput.trim() || !currentEventSlug) return;
    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.joinEvent(currentEventSlug, guestNameInput);
      setGuestToken(currentEventSlug, res.guest.token);
      const eventObj = res.event ||
        guestEventData || {
          slug: currentEventSlug,
          name: currentEventSlug.replace(/-/g, " ").toUpperCase(),
          date: new Date().toISOString().split("T")[0],
          guest_upload_limit: 20,
          status: "active",
        };
      guestEventData = eventObj;
      const limit = Number(eventObj.guest_upload_limit) || 20;
      const used = Number(res.guest?.upload_count) || 0;
      guestSession = {
        guest: res.guest,
        event: eventObj,
        quota: {
          used,
          limit,
          remaining: Math.max(0, limit - used),
        },
      };
      guestNameInput = "";
      await loadMyUploads(currentEventSlug, res.guest.token);
      if (wsHandle) {
        wsHandle.notifyGuestJoin({
          name: res.guest.name,
          token: res.guest.token,
        });
        if (typeof wsHandle.requestGallerySync === "function") {
          wsHandle.requestGallerySync();
        }
      }
    } catch (err) {
      console.error("handleGuestJoin error:", err);
      errorMsg = err.message || "Failed to join event";
    } finally {
      isSubmitting = false;
    }
  }

  function handleGuestLeave() {
    if (confirm("Leave this event on this device?")) {
      setGuestToken(currentEventSlug, "");
      guestSession = null;
      myUploads = [];
    }
  }

  async function refreshOfflineQueueCount() {
    if (!currentEventSlug) return;
    const queued = await getOfflineQueue(currentEventSlug);
    offlineQueueCount = queued.length;
  }

  async function checkAndFlushOfflineQueue() {
    if (!isOnline || !currentEventSlug || !guestSession || isFlushingQueue)
      return;
    const queued = await getOfflineQueue(currentEventSlug);
    if (!queued.length) return;

    isFlushingQueue = true;
    uploadProgressText = `Syncing ${queued.length} offline photo(s)...`;

    const result = await flushOfflineQueue(
      currentEventSlug,
      ({ current, total }) => {
        uploadProgressText = `Syncing offline queue (${current}/${total})...`;
      },
      (res) => {
        if (res.quota) {
          guestSession.quota = res.quota;
          guestSession.guest.upload_count = res.quota.used;
        }
      },
    );

    isFlushingQueue = false;
    uploadProgressText = "";
    await refreshOfflineQueueCount();
    await Promise.all([
      loadMyUploads(currentEventSlug, guestSession.guest.token),
      loadGuestExperience(currentEventSlug),
    ]);

    if (result.uploaded > 0) {
      successMsg = `Offline sync complete! ${result.uploaded} photo(s) uploaded.`;
      setTimeout(() => (successMsg = ""), 4000);
    }
  }

  async function handleInstallPWA() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") {
      showInstallButton = false;
    }
    deferredInstallPrompt = null;
  }

  // --- PHOTO UPLOAD & DELETE LOGIC ---
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !guestSession || !currentEventSlug) return;

    if (guestEventData?.status === "archived") {
      alert("This event has ended and is no longer accepting new uploads.");
      e.target.value = "";
      return;
    }

    isUploading = true;
    uploadTotalCount = files.length;
    uploadCurrentIndex = 0;
    errorMsg = "";
    successMsg = "";

    let successCount = 0;
    let offlineQueuedCount = 0;
    let failMsg = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      uploadCurrentIndex = i + 1;
      uploadProgressText = `Optimizing & hashing photo ${i + 1} of ${files.length}...`;

      if (!isOnline) {
        try {
          await enqueueOfflinePhoto(
            currentEventSlug,
            file,
            guestSession.guest.token,
          );
          offlineQueuedCount++;
          uploadProgressText = `Queued photo ${i + 1} of ${files.length} (offline)`;
        } catch (err) {
          console.error("Offline queue failed:", err);
          failMsg = "Failed to queue offline photo";
        }
      } else {
        try {
          uploadProgressText = `Sending photo ${i + 1} of ${files.length} to Host Moderation Queue...`;
          const res = await api.uploadPhoto(
            currentEventSlug,
            file,
            guestSession.guest.token,
          );
          successCount++;
          guestSession.quota = res.quota;
          guestSession.guest.upload_count = res.quota.used;

          if (wsHandle && res.processed) {
            let cloudUploaded = false;
            try {
              uploadProgressText = `Connecting cloud upload slot (${i + 1}/${files.length})...`;
              const session = await wsHandle.requestGDriveUploadSession(
                {
                  filename: res.processed.filename,
                  mimeType: res.processed.mimeType,
                  origSize: res.processed.originalBlob.size,
                  thumbSize: res.processed.thumbBlob.size,
                  hash: res.processed.hash
                },
                {
                  name: guestSession.guest.name,
                  token: guestSession.guest.token
                }
              );

              if (session && session.origUploadUri && session.thumbUploadUri) {
                uploadProgressText = `Streaming photo ${i + 1} of ${files.length} to Google Drive...`;
                const [origResult, thumbResult] = await Promise.all([
                  gdrive.uploadBlobToResumableSession(
                    session.origUploadUri,
                    res.processed.originalBlob,
                    res.processed.mimeType
                  ),
                  gdrive.uploadBlobToResumableSession(
                    session.thumbUploadUri,
                    res.processed.thumbBlob,
                    'image/jpeg'
                  )
                ]);

                wsHandle.notifyGDrivePhotoUploaded({
                  driveOrigId: origResult?.id || '',
                  driveThumbId: thumbResult?.id || '',
                  filename: res.processed.filename,
                  hash: res.processed.hash,
                  width: res.processed.width,
                  height: res.processed.height,
                  size: res.processed.size,
                  mimeType: res.processed.mimeType,
                  guest_name: guestSession.guest.name,
                  guest_token: guestSession.guest.token
                });
                cloudUploaded = true;
              }
            } catch (cloudErr) {
              console.warn('Direct Google Drive upload failed, falling back to direct relay:', cloudErr);
            }

            if (!cloudUploaded && typeof wsHandle.sendPhotoDirect === 'function') {
              try {
                uploadProgressText = `Delivering photo ${i + 1} of ${files.length} to Host Queue...`;
                const thumbDataUrl = await blobToBase64(res.processed.thumbBlob);
                const originalDataUrl = await blobToBase64(res.processed.originalBlob);
                wsHandle.sendPhotoDirect({
                  filename: res.processed.filename,
                  hash: res.processed.hash,
                  width: res.processed.width,
                  height: res.processed.height,
                  size: res.processed.size,
                  mimeType: res.processed.mimeType,
                  guest_name: guestSession.guest.name,
                  guest_token: guestSession.guest.token,
                  thumbDataUrl,
                  originalDataUrl
                });
              } catch (fallbackErr) {
                console.error('Direct fallback transmission error:', fallbackErr);
              }
            }
          }
        } catch (err) {
          if (
            err.message &&
            (err.message.includes("fetch") ||
              err.message.includes("network") ||
              err.message.includes("Failed to fetch") ||
              err.message.includes("offline"))
          ) {
            try {
              await enqueueOfflinePhoto(
                currentEventSlug,
                file,
                guestSession.guest.token,
              );
              offlineQueuedCount++;
            } catch (qErr) {
              failMsg = "Upload failed and offline queue unavailable";
            }
          } else {
            failMsg = err.message || "Upload failed";
            console.error("Photo upload failed:", err);
          }
        }
      }
    }

    e.target.value = "";
    isUploading = false;
    uploadCurrentIndex = 0;
    uploadTotalCount = 0;
    uploadProgressText = "";

    await refreshOfflineQueueCount();
    if (guestSession?.guest?.token) {
      await loadMyUploads(currentEventSlug, guestSession.guest.token);
    }

    if (successCount > 0) {
      successMsg =
        successCount === 1
          ? "🎉 Photo delivered to Host Moderation Queue!"
          : `🎉 All ${successCount} photos submitted to Host Moderation Queue!`;
      setTimeout(() => (successMsg = ""), 5000);
    }

    if (offlineQueuedCount > 0) {
      successMsg = `${offlineQueuedCount} photo(s) saved to offline queue! Will auto-upload when reconnected.`;
      setTimeout(() => (successMsg = ""), 5000);
    }

    if (failMsg) {
      errorMsg = failMsg;
    }
  }

  async function handleDeleteOwnPhoto(photoId, photoObj = null) {
    if (
      !confirm(
        "Remove this photo from the event? Your upload slot will be freed.",
      )
    )
      return;
    try {
      const deletedPhoto = photoObj || myUploads.find(p => p.id === photoId) || liveGalleryPhotos.find(p => p.id === photoId);
      const photoHash = deletedPhoto?.hash;
      const photoFilename = deletedPhoto?.filename;
      const res = await api.deletePhoto(
        currentEventSlug,
        photoId,
        guestSession?.guest?.token,
      );
      myUploads = myUploads.filter((p) => p.id !== photoId && (!photoHash || p.hash !== photoHash));
      liveGalleryPhotos = liveGalleryPhotos.filter((p) => p.id !== photoId && (!photoHash || p.hash !== photoHash));
      if (guestSession?.quota) {
        guestSession.quota = res.quota;
        if (guestSession.guest) guestSession.guest.upload_count = res.quota.used;
      }
      if (selectedPreviewPhoto && (selectedPreviewPhoto.id === photoId || (photoHash && selectedPreviewPhoto.hash === photoHash))) {
        selectedPreviewPhoto = null;
      }

      // Send real-time signal to host and all attendees
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: {
            id: photoId,
            hash: photoHash,
            filename: photoFilename,
            event_slug: currentEventSlug,
            guest_token: guestSession?.guest?.token
          }
        });
      }

      successMsg = "Photo removed and slot freed!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to delete photo: " + err.message);
    }
  }

  // --- SELECTION & DOWNLOAD LOGIC ---
  function togglePhotoSelection(photoId) {
    if (selectedPhotoIds.has(photoId)) {
      selectedPhotoIds.delete(photoId);
    } else {
      selectedPhotoIds.add(photoId);
    }
    selectedPhotoIds = new Set(selectedPhotoIds);
  }

  async function handleDownloadSelected() {
    if (!selectedPhotoIds.size) return;
    isDownloadingZip = true;
    try {
      await downloadSelectedZip(currentEventSlug, Array.from(selectedPhotoIds));
      isSelectionMode = false;
      selectedPhotoIds = new Set();
    } catch (err) {
      alert("Failed to download ZIP: " + err.message);
    } finally {
      isDownloadingZip = false;
    }
  }

  // --- SLIDESHOW / TV MODE LOGIC ---
  async function loadSlideshowExperience(slug) {
    try {
      const [eventRes, photosRes, configRes] = await Promise.all([
        api.getEvent(slug),
        api.getPhotos(slug, { status: "approved" }),
        api.getSlideshowConfig(slug),
      ]);
      guestEventData = eventRes.event;
      slideshowPhotos = photosRes.photos || [];
      slideshowConfig = configRes.config;
      currentSlideIndex = 0;
      startSlideshowTimer();
    } catch (err) {
      errorMsg = err.message || "Failed to load slideshow";
    }
  }

  function startSlideshowTimer() {
    if (slideshowTimer) clearInterval(slideshowTimer);
    const intervalMs = (slideshowConfig.interval || 5) * 1000;
    slideshowTimer = setInterval(() => {
      if (!isSlideshowPaused && slideshowPhotos.length > 1) {
        nextSlide();
      }
    }, intervalMs);
  }

  function nextSlide() {
    if (!slideshowPhotos.length) return;
    currentSlideIndex = (currentSlideIndex + 1) % slideshowPhotos.length;
  }

  function prevSlide() {
    if (!slideshowPhotos.length) return;
    currentSlideIndex =
      (currentSlideIndex - 1 + slideshowPhotos.length) % slideshowPhotos.length;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function exitSlideshow() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    const hostToken = localStorage.getItem('caps_host_token');
    if (hostToken || authStatus.is_authenticated) {
      navigate('/');
    } else {
      navigate(`/event/${currentEventSlug}`);
    }
  }

  function handleKeyDown(e) {
    if (!isSlideshowRoute) return;
    if (e.key === "ArrowRight") {
      nextSlide();
    } else if (e.key === "ArrowLeft") {
      prevSlide();
    } else if (e.key === " ") {
      isSlideshowPaused = !isSlideshowPaused;
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    } else if (e.key === "Escape") {
      if (!document.fullscreenElement) {
        exitSlideshow();
      }
    }
  }

  onMount(() => {
    initView();

    const handleRouteChange = () => {
      initView();
    };

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("keydown", handleKeyDown);

    const updateOnlineStatus = () => {
      isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (isOnline) {
        checkAndFlushOfflineQueue();
      }
    };

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      showInstallButton = true;
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      if (slideshowTimer) clearInterval(slideshowTimer);
    };
  });

  onDestroy(() => {
    if (wsHandle) {
      wsHandle.disconnect();
    }
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
    }
  });
</script>

<div class="app-container {isSlideshowRoute ? 'slideshow-mode-container' : ''}">
  <!-- TOP HEADER (Hidden in Slideshow / TV Mode) -->
  {#if !isSlideshowRoute}
    <header class="app-header">
      <div class="header-inner">
        <button class="brand" onclick={() => navigate("/")}>
          {#if isGuestRoute && guestEventData?.logo}
            <img
              src={guestEventData.logo}
              alt="Event logo"
              class="custom-brand-logo"
            />
          {:else if selectedEvent?.logo && hostView === "event_detail"}
            <img
              src={selectedEvent.logo}
              alt="Event logo"
              class="custom-brand-logo"
            />
          {:else}
            <div class="logo-icon">📸</div>
          {/if}
          <div class="text-left">
            <h1 class="brand-title">EventCaps</h1>
            <span class="brand-subtitle">
              {#if isGuestRoute && guestEventData}
                {guestEventData.name}
              {:else}
                Event Photo Hub
              {/if}
            </span>
          </div>
        </button>

        <div class="header-actions">
          {#if showInstallButton}
            <button
              class="btn-primary btn-sm install-pwa-btn"
              onclick={handleInstallPWA}
            >
              <span>📲</span> Install App
            </button>
          {/if}

          {#if !isOnline}
            <span class="offline-status-pill">
              🔴 Offline {offlineQueueCount > 0
                ? `(${offlineQueueCount} queued)`
                : ""}
            </span>
          {/if}

          {#if !isGuestRoute && authStatus.is_authenticated}
            {#if isDriveConnected}
              <span class="status-pill pill-approved" style="font-size: 0.8125rem;">
                ☁️ Google Drive Connected
              </span>
            {:else}
              <button
                class="btn-secondary btn-sm"
                onclick={handleConnectGoogleDrive}
                title="Connect Google Drive to store event photos"
              >
                <span>☁️</span> Connect Google Drive
              </button>
            {/if}
            <button
              class="btn-secondary btn-sm host-badge"
              onclick={openProfileModal}
              title="Edit Host Profile & PIN"
              style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;"
            >
              <span>👤</span> <strong>{authStatus.host_name}</strong> <span>⚙️</span>
            </button>
            <button class="btn-secondary btn-sm" onclick={handleLogout}
              >Lock</button
            >
          {:else if isGuestRoute && guestSession}
            <span class="guest-pill">👋 {guestSession.guest.name}</span>
            <button class="btn-secondary btn-sm" onclick={handleGuestLeave}
              >Leave</button
            >
          {:else if isGuestRoute}
            <button class="btn-secondary btn-sm" onclick={() => navigate("/")}
              >Host Login</button
            >
          {/if}
        </div>
      </div>
    </header>
  {/if}

  <!-- MAIN CONTENT -->
  <main class="main-content {isSlideshowRoute ? 'slideshow-main' : ''}">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Connecting to EventCaps...</p>
      </div>

      <!-- ========================================== -->
      <!-- PRIVACY POLICY VIEW                        -->
      <!-- ========================================== -->
    {:else if isPrivacyRoute}
      <div class="card policy-card text-left" style="max-width: 780px; margin: 2rem auto; padding: 2.5rem; line-height: 1.7;">
        <button class="btn-secondary btn-sm" style="margin-bottom: 1.5rem;" onclick={() => navigate("/")}>
          ← Back to EventCaps
        </button>
        <h2 style="font-size: 1.75rem; margin-bottom: 0.25rem;">Privacy Policy</h2>
        <p class="text-secondary" style="font-size: 0.875rem; margin-bottom: 2rem;">Last Updated: August 2026</p>

        <h3 style="margin-top: 1.5rem;">1. Overview</h3>
        <p class="text-secondary">EventCaps (<code>https://deidi.github.io/event-caps/</code>) is a server-less event photo sharing hub. We are committed to protecting your privacy and providing transparent information regarding how data is handled.</p>

        <h3 style="margin-top: 1.5rem;">2. Google Drive Permissions & Data Use</h3>
        <p class="text-secondary">EventCaps connects to your Google Account using the restricted <code>https://www.googleapis.com/auth/drive.file</code> OAuth scope. This permission is strictly used to:</p>
        <ul style="margin: 0.75rem 0 1.25rem 1.5rem; color: var(--color-text-secondary);">
          <li>Create a dedicated folder named <code>/EventCaps Events</code> in your personal Google Drive.</li>
          <li>Upload event photos taken and submitted by attendees during your event.</li>
          <li>Store a lightweight event manifest snapshot (<code>event_manifest.json</code>) for event metadata.</li>
        </ul>
        <p class="text-secondary"><strong>Strict Isolation:</strong> EventCaps does not access, view, modify, or delete any other files, documents, or folders in your Google Drive.</p>

        <h3 style="margin-top: 1.5rem;">3. Client-Side Processing</h3>
        <p class="text-secondary">All photo compression, thumbnail generation, duplicate detection, and metadata formatting are executed entirely within your web browser using HTML5 Canvas. No photos or Google access tokens are transmitted to or stored on third-party backend servers.</p>

        <h3 style="margin-top: 1.5rem;">4. Revoking Access</h3>
        <p class="text-secondary">You can disconnect Google Drive at any time from within the EventCaps dashboard, or revoke access from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary);">Google Account Security Settings</a>.</p>
      </div>

      <!-- ========================================== -->
      <!-- TERMS OF SERVICE VIEW                      -->
      <!-- ========================================== -->
    {:else if isTermsRoute}
      <div class="card policy-card text-left" style="max-width: 780px; margin: 2rem auto; padding: 2.5rem; line-height: 1.7;">
        <button class="btn-secondary btn-sm" style="margin-bottom: 1.5rem;" onclick={() => navigate("/")}>
          ← Back to EventCaps
        </button>
        <h2 style="font-size: 1.75rem; margin-bottom: 0.25rem;">Terms of Service</h2>
        <p class="text-secondary" style="font-size: 0.875rem; margin-bottom: 2rem;">Last Updated: August 2026</p>

        <h3 style="margin-top: 1.5rem;">1. Acceptance of Terms</h3>
        <p class="text-secondary">By accessing or using EventCaps, you agree to comply with and be bound by these Terms of Service.</p>

        <h3 style="margin-top: 1.5rem;">2. User-Generated Content</h3>
        <p class="text-secondary">Attendees retain rights to photos they capture and upload. Users agree not to upload harmful, offensive, or infringing material. Event hosts retain full moderation rights to approve, reject, or remove photos from their event space.</p>

        <h3 style="margin-top: 1.5rem;">3. Disclaimer & Limitation of Liability</h3>
        <p class="text-secondary">EventCaps is provided on an "as is" and "as available" basis without warranties of any kind. EventCaps is not liable for data loss or service interruptions resulting from third-party cloud services.</p>
      </div>

      <!-- ========================================== -->
      <!-- SLIDESHOW / TV MODE VIEW                   -->
      <!-- ========================================== -->
    {:else if isSlideshowRoute}
      <div class="slideshow-stage">
        {#if slideshowPhotos.length === 0}
          <div class="slideshow-empty">
            <div class="slideshow-logo">📸</div>
            <h1>{guestEventData?.name || "EventCaps Slideshow"}</h1>
            {#if guestEventData?.tagline}
              <p class="slideshow-tagline">{guestEventData.tagline}</p>
            {/if}
            <p class="slideshow-waiting">
              Waiting for approved photos from attendees...
            </p>
            {#if slideshowConfig.qr_data_url}
              <div class="slideshow-empty-qr">
                <img
                  src={slideshowConfig.qr_data_url}
                  alt="Join QR"
                  class="empty-qr-img"
                />
                <p>Scan with phone to share photos</p>
              </div>
            {/if}
          </div>
        {:else}
          <!-- ACTIVE PHOTO DISPLAY -->
          {#key currentSlideIndex}
            <div
              class="slide-item-wrapper transition-{slideshowConfig.transition ||
                'fade'}"
            >
              <img
                src={slideshowPhotos[currentSlideIndex].original_path}
                alt="Slideshow memory"
                class="slide-img"
              />
            </div>
          {/key}

          <!-- AUTHOR WATERMARK (Subtle) -->
          {#if slideshowConfig.show_author && slideshowPhotos[currentSlideIndex]?.guest_name}
            <div class="slideshow-author-badge">
              <span
                >📸 Captured by <strong
                  >{slideshowPhotos[currentSlideIndex].guest_name}</strong
                ></span
              >
            </div>
          {/if}

          <!-- CORNER QR CODE OVERLAY (PIP) -->
          {#if slideshowConfig.show_qr && slideshowConfig.qr_data_url}
            <div class="slideshow-qr-pip">
              {#if guestEventData?.logo}
                <img
                  src={guestEventData.logo}
                  alt="Event logo"
                  style="max-height: 24px; max-width: 100px; object-fit: contain; margin-bottom: 0.25rem;"
                />
              {/if}
              <img
                src={slideshowConfig.qr_data_url}
                alt="Join Event QR"
                class="pip-qr-img"
              />
              <span class="pip-label">Scan to Share</span>
            </div>
          {/if}

          <!-- FLOATING CONTROLS (Hover) -->
          <div class="slideshow-controls-overlay">
            <button
              class="slide-ctrl-btn"
              onclick={prevSlide}
              title="Previous photo (&larr;)"
            >
              &#10094;
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={() => (isSlideshowPaused = !isSlideshowPaused)}
              title="Pause / Play (Space)"
            >
              {isSlideshowPaused ? "▶" : "⏸"}
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={nextSlide}
              title="Next photo (&rarr;)"
            >
              &#10095;
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={toggleFullscreen}
              title="Fullscreen (F)"
            >
              ⛶
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={exitSlideshow}
              title="Exit (Esc)"
            >
              &times;
            </button>
          </div>
        {/if}
      </div>

      <!-- ========================================== -->
      <!-- GUEST EXPERIENCE VIEW                     -->
      <!-- ========================================== -->
    {:else if isGuestRoute}
      {#if !guestSession}
        <!-- 1. GUEST JOIN SCREEN -->
        <div class="card auth-card guest-join-card">
          {#if guestEventData?.logo}
            <div style="margin-bottom: 1rem;">
              <img
                src={guestEventData.logo}
                alt="Event logo"
                style="max-height: 80px; max-width: 200px; object-fit: contain;"
              />
            </div>
          {/if}
          <div class="event-badge-top">Event Space</div>
          <h2 class="event-hero-title">
            {guestEventData?.name ||
              currentEventSlug.replace(/-/g, " ").toUpperCase()}
          </h2>
          {#if guestEventData?.tagline}
            <p class="event-hero-tagline">{guestEventData.tagline}</p>
          {/if}
          <p class="event-hero-date">
            📅 {guestEventData?.date || new Date().toISOString().split("T")[0]}
          </p>

          <div class="join-divider"></div>

          {#if guestEventData?.status === "archived"}
            <div class="alert-archived-banner">
              🔒 <strong>This event has concluded.</strong> You can browse and download
              all shared memories below.
            </div>
          {:else}
            <p
              class="text-secondary"
              style="font-size: 0.9375rem; margin-bottom: 1.25rem;"
            >
              Enter your name to share photos and view the live gallery. No
              password required!
            </p>
          {/if}

          {#if errorMsg}
            <div class="alert-error" style="margin-bottom: 1rem;">
              {errorMsg}
            </div>
          {/if}

          <form onsubmit={handleGuestJoin} class="form-stack">
            <div>
              <label class="form-label" for="guestName">Your Name</label>
              <input
                id="guestName"
                type="text"
                class="input-field"
                placeholder="e.g. Sarah / David Miller"
                bind:value={guestNameInput}
                required
              />
            </div>

            <button
              type="submit"
              class="btn-primary btn-lg"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Joining..."
                : guestEventData?.status === "archived"
                  ? "Enter Event Gallery →"
                  : "Join & Share Photos →"}
            </button>
          </form>

          <div class="guest-join-footer">
            <span
              >🔒 Photos shared in real-time over peer-to-peer connection</span
            >
          </div>
        </div>

        <!-- 2. GUEST EVENT SPACE (Active Session) -->
      {:else}
        <div class="guest-space-container">
          <!-- Hidden File Inputs -->
          <input
            type="file"
            accept="image/*"
            capture="environment"
            bind:this={cameraInputEl}
            onchange={handleFileSelect}
            style="display: none;"
          />
          <input
            type="file"
            accept="image/*"
            multiple
            bind:this={fileInputEl}
            onchange={handleFileSelect}
            style="display: none;"
          />

          <!-- Notification Banners -->
          {#if successMsg}
            <div class="alert-success">✨ {successMsg}</div>
          {/if}
          {#if errorMsg}
            <div class="alert-error">⚠️ {errorMsg}</div>
          {/if}

          <!-- ARCHIVED BANNER -->
          {#if guestEventData.status === "archived"}
            <div class="alert-archived-banner">
              🏁 <strong>This event has concluded.</strong> Thank you for capturing
              memories! New uploads are closed, but you can view and download all
              approved photos below.
            </div>
          {/if}

          <!-- Event Header Banner -->
          <div class="card event-banner-card">
            <div class="event-banner-flex">
              <div>
                <span class="event-status status-{guestEventData.status}">
                  {guestEventData.status === "active"
                    ? "Live Event"
                    : "Concluded"}
                </span>
                <h2>{guestEventData.name}</h2>
                {#if guestEventData.tagline}
                  <p class="text-secondary" style="margin-top: 0.25rem;">
                    {guestEventData.tagline}
                  </p>
                {/if}
                <p
                  class="text-secondary"
                  style="font-size: 0.8125rem; margin-top: 0.25rem;"
                >
                  📅 {guestEventData.date}
                </p>
              </div>

              <!-- Upload Quota Card -->
              <div class="quota-badge">
                <span class="quota-count"
                  >{guestSession.quota.used} / {guestSession.quota.limit}</span
                >
                <span class="quota-label">Photos Uploaded</span>
              </div>
            </div>

            <!-- Upload Action Bar -->
            <div class="guest-action-bar">
              <div class="action-buttons-group">
                <button
                  class="btn-primary"
                  disabled={isUploading ||
                    guestSession.quota.remaining <= 0 ||
                    guestEventData.status === "archived"}
                  onclick={() => cameraInputEl?.click()}
                >
                  <span>📷</span>
                  {guestEventData.status === "archived"
                    ? "Uploads Closed"
                    : "Take Photo"}
                </button>
                <button
                  class="btn-secondary"
                  disabled={isUploading ||
                    guestSession.quota.remaining <= 0 ||
                    guestEventData.status === "archived"}
                  onclick={() => fileInputEl?.click()}
                >
                  <span>🖼️</span> Camera Roll
                </button>
                <button
                  class="btn-secondary"
                  onclick={() =>
                    navigate(`/event/${guestEventData.slug}/slideshow`)}
                >
                  <span>📺</span> TV Slideshow
                </button>
              </div>

              {#if isUploading}
                <div class="batch-upload-banner">
                  <div class="batch-upload-header">
                    <div class="batch-upload-title">
                      <div class="mini-spinner"></div>
                      <span>Uploading Photos ({uploadCurrentIndex} of {uploadTotalCount})</span>
                    </div>
                    <span class="batch-upload-percent">
                      {uploadTotalCount > 0 ? Math.round((uploadCurrentIndex / uploadTotalCount) * 100) : 0}%
                    </span>
                  </div>
                  <div class="batch-progress-track">
                    <div
                      class="batch-progress-fill"
                      style="width: {uploadTotalCount > 0 ? Math.max(8, (uploadCurrentIndex / uploadTotalCount) * 100) : 0}%;"
                    ></div>
                  </div>
                  <p class="batch-upload-status">
                    🔄 {uploadProgressText || "Sending to Host Moderation Queue..."}
                  </p>
                </div>
              {:else if guestEventData.status !== "archived"}
                <span class="quota-helper">
                  Remaining slots: <strong
                    >{guestSession.quota.remaining}</strong
                  >
                </span>
              {/if}
            </div>
          </div>

          <!-- MY UPLOADS SECTION -->
          {#if myUploads.length > 0}
            <div class="card uploads-section">
              <div class="section-title-row">
                <h3>My Shared Photos ({myUploads.length})</h3>
                <span class="text-secondary" style="font-size: 0.8125rem;"
                  >Uploaded by you</span
                >
              </div>

              <div class="uploads-grid">
                {#each myUploads as photo}
                  <div class="upload-item-card">
                    <button
                      class="upload-thumb-click"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={photo.thumbnail_path}
                        alt="Uploaded thumbnail"
                        class="upload-thumb"
                      />
                    </button>
                    <div class="upload-badge-overlay">
                      {#if photo.status === "pending"}
                        <span class="status-pill pill-pending">🟡 Pending</span>
                      {:else if photo.status === "approved"}
                        <span class="status-pill pill-approved">🟢 Live</span>
                      {:else}
                        <span class="status-pill pill-rejected"
                          >🔴 Rejected</span
                        >
                      {/if}
                    </div>
                    <button
                      class="delete-photo-btn"
                      title="Remove photo & free slot"
                      onclick={(e) => {
                        e.stopPropagation();
                        handleDeleteOwnPhoto(photo.id, photo);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- LIVE GALLERY SECTION -->
          <div class="card gallery-section">
            <div class="gallery-header">
              <div>
                <h3>Live Memories Wall ({liveGalleryPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.8125rem;">
                  Real-time feed of approved photos from everyone
                </p>
              </div>

              <div class="gallery-controls">
                {#if liveGalleryPhotos.length > 0}
                  <button
                    class="btn-secondary btn-sm"
                    onclick={() => {
                      isSelectionMode = !isSelectionMode;
                      selectedPhotoIds = new Set();
                    }}
                  >
                    {isSelectionMode ? "Cancel Selection" : "Select Photos"}
                  </button>

                  <button
                    class="btn-secondary btn-sm"
                    disabled={isExportingArchive}
                    onclick={() => handleExportFullArchive(guestEventData.slug)}
                  >
                    <span>💾</span>
                    {isExportingArchive
                      ? "Packaging ZIP..."
                      : "Download All (.ZIP)"}
                  </button>
                {/if}

                <div class="live-dot-badge">
                  <span class="pulse-dot"></span>
                  <span
                    >{wsConnectionStatus === "connected"
                      ? "Live Sync"
                      : "Reconnecting..."}</span
                  >
                </div>
              </div>
            </div>

            <!-- Multi-Selection Action Toolbar -->
            {#if isSelectionMode}
              <div class="selection-toolbar">
                <span
                  >Selected: <strong>{selectedPhotoIds.size}</strong> photos</span
                >
                <div class="selection-actions">
                  <button
                    class="btn-primary btn-sm"
                    disabled={selectedPhotoIds.size === 0 || isDownloadingZip}
                    onclick={handleDownloadSelected}
                  >
                    {isDownloadingZip
                      ? "Archiving..."
                      : `Download Selected (${selectedPhotoIds.size}) .ZIP`}
                  </button>
                </div>
              </div>
            {/if}

            {#if liveGalleryPhotos.length === 0}
              <div class="empty-gallery">
                <div class="empty-icon">✨</div>
                <h4>No memories live yet!</h4>
                <p
                  class="text-secondary"
                  style="max-width: 420px; margin: 0.5rem auto 0 auto;"
                >
                  Photos uploaded by guests will appear here as soon as approved
                  by staff.
                </p>
                {#if guestEventData.status === "active"}
                  <div style="margin-top: 1.25rem;">
                    <button
                      class="btn-primary"
                      onclick={() => cameraInputEl?.click()}
                    >
                      <span>📷</span> Take Photo
                    </button>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="live-gallery-grid">
                {#each liveGalleryPhotos as photo}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="gallery-item-card {isSelectionMode &&
                    selectedPhotoIds.has(photo.id)
                      ? 'selected-card'
                      : ''}"
                    onclick={() =>
                      isSelectionMode
                        ? togglePhotoSelection(photo.id)
                        : (selectedPreviewPhoto = photo)}
                  >
                    <img
                      src={photo.thumbnail_path || photo.thumb_url || photo.drive_thumb_url || photo.original_path || photo.original_url}
                      alt="Event memory"
                      class="gallery-thumb"
                      loading="lazy"
                    />

                    {#if isSelectionMode}
                      <div class="select-checkbox-overlay">
                        <input
                          type="checkbox"
                          checked={selectedPhotoIds.has(photo.id)}
                          onchange={() => togglePhotoSelection(photo.id)}
                        />
                      </div>
                    {/if}

                    <div class="gallery-info-overlay">
                      <span class="gallery-author"
                        >📸 {photo.guest_name || "Guest"}</span
                      >
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ========================================== -->
      <!-- HOST DASHBOARD VIEW                        -->
      <!-- ========================================== -->
    {:else if errorMsg && !authStatus.initialized}
      <div class="card auth-card">
        <h2 style="color: var(--color-danger)">Connection Error</h2>
        <p class="text-secondary" style="margin: 0.5rem 0 1.5rem 0">
          {errorMsg}
        </p>
        <button class="btn-primary" onclick={checkAuth}>Retry</button>
      </div>

      <!-- 1. FIRST-TIME SETUP / PUBLIC LANDING -->
    {:else if !authStatus.initialized}
      <div class="landing-container" style="max-width: 900px; margin: 1.5rem auto; text-align: center;">
        <div class="hero-section" style="margin-bottom: 2rem;">
          <h1 style="font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem;">📸 EventCaps</h1>
          <p class="text-secondary" style="font-size: 1.125rem; max-width: 620px; margin: 0 auto 1.5rem auto;">
            A 100% server-less, cloud-first event photo sharing hub. Capture, moderate, and stream live event memories with Google Drive cloud hosting.
          </p>
          <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2rem;">
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; text-align: left; max-width: 270px; flex: 1 1 240px;">
              <div style="font-size: 1.75rem; margin-bottom: 0.35rem;">☁️</div>
              <strong style="font-size: 1rem;">100+ Live Uploads</strong>
              <p class="text-secondary" style="font-size: 0.8125rem; margin-top: 0.35rem; line-height: 1.4;">Direct Google Drive cloud storage and high-speed Google CDN photo delivery.</p>
            </div>
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; text-align: left; max-width: 270px; flex: 1 1 240px;">
              <div style="font-size: 1.75rem; margin-bottom: 0.35rem;">📺</div>
              <strong style="font-size: 1rem;">Live Slideshow</strong>
              <p class="text-secondary" style="font-size: 0.8125rem; margin-top: 0.35rem; line-height: 1.4;">Real-time TV and projector presentation mode with live auto-rotating slides.</p>
            </div>
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; text-align: left; max-width: 270px; flex: 1 1 240px;">
              <div style="font-size: 1.75rem; margin-bottom: 0.35rem;">🔒</div>
              <strong style="font-size: 1rem;">Host Moderation</strong>
              <p class="text-secondary" style="font-size: 0.8125rem; margin-top: 0.35rem; line-height: 1.4;">Client-side approval queue to review and manage all incoming photos.</p>
            </div>
          </div>
        </div>

        <div class="card auth-card" style="margin: 0 auto; text-align: left;">
          <div class="auth-icon" style="text-align: center;">🚀</div>
          <h2 style="text-align: center;">Host Setup</h2>
          <p class="text-secondary" style="margin: 0.5rem 0 1.5rem 0; text-align: center;">
            Set up your host profile to create events, customize branding, and moderate photos.
          </p>

          {#if errorMsg}
            <div class="alert-error">{errorMsg}</div>
          {/if}

          <form onsubmit={handleSetup} class="form-stack">
            <div>
              <label class="form-label" for="hostName">Your Name / Role</label>
              <input
                id="hostName"
                type="text"
                class="input-field"
                placeholder="e.g. Pastor John / Media Team"
                bind:value={setupName}
                required
              />
            </div>

            <div>
              <label class="form-label" for="hostPin">Admin PIN (4+ digits)</label>
              <input
                id="hostPin"
                type="password"
                class="input-field"
                placeholder="••••"
                maxlength="8"
                bind:value={setupPin}
                required
              />
            </div>

            <button
              type="submit"
              class="btn-primary"
              style="width: 100%; margin-top: 0.5rem;"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Setting up..." : "Start EventCaps"}
            </button>
          </form>
        </div>
      </div>

      <!-- 2. UNLOCK PIN SCREEN -->
    {:else if !authStatus.is_authenticated}
      <div class="card auth-card">
        <div class="auth-icon">🔒</div>
        <h2>Host Dashboard Locked</h2>
        <p class="text-secondary" style="margin: 0.5rem 0 1.5rem 0;">
          Enter your admin PIN to access the EventCaps management console.
        </p>

        {#if errorMsg}
          <div class="alert-error">{errorMsg}</div>
        {/if}

        <form onsubmit={handleUnlock} class="form-stack">
          <div>
            <label class="form-label" for="unlockPin">Admin PIN</label>
            <input
              id="unlockPin"
              type="password"
              class="input-field"
              placeholder="••••"
              maxlength="8"
              bind:value={unlockPin}
              required
            />
          </div>

          <button
            type="submit"
            class="btn-primary"
            style="width: 100%; margin-top: 0.5rem;"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Verifying..." : "Unlock Dashboard"}
          </button>
        </form>
      </div>

      <!-- 3. HOST DASHBOARD -->
    {:else if hostView === "dashboard"}
      <div class="dashboard-view">
        <div class="dashboard-toolbar">
          <div>
            <h2>Event Spaces</h2>
            <p class="text-secondary">
              Manage gatherings, generate QR codes, and moderate captures.
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
            {#if isDriveConnected}
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="status-pill pill-approved">
                  ☁️ Google Drive Connected
                </span>
                <button
                  class="btn-secondary btn-sm"
                  onclick={handleDisconnectGoogleDrive}
                  title="Disconnect Google Drive"
                >
                  Disconnect
                </button>
              </div>
            {:else}
              <button
                class="btn-secondary"
                onclick={handleConnectGoogleDrive}
                title="Connect your Google Drive to host photos for 100+ guests"
              >
                <span>☁️</span> Connect Google Drive (100+ Mode)
              </button>
            {/if}
            <button
              class="btn-primary"
              onclick={() => (isCreateModalOpen = true)}
            >
              <span>+</span> Create New Event
            </button>
          </div>
        </div>

        {#if events.length === 0}
          <div class="card empty-state" style="margin-top: 1.5rem;">
            <div class="empty-icon">📁</div>
            <h3>No events created yet</h3>
            <p class="text-secondary">
              Create your first event space to generate QR codes and start
              receiving memories from attendees.
            </p>
          </div>
        {:else}
          <div class="events-grid" style="margin-top: 1.5rem;">
            {#each events as event}
              <div class="card event-card text-left">
                <div class="event-card-header">
                  <div>
                    <span class="event-status status-{event.status}"
                      >{event.status}</span
                    >
                    <h3 class="event-title">{event.name}</h3>
                    {#if event.tagline}
                      <p class="event-tagline">{event.tagline}</p>
                    {/if}
                  </div>
                  <span class="event-date">📅 {event.date}</span>
                </div>

                <div class="event-stats">
                  <div class="stat-item">
                    <span class="stat-value">{event.total_photos || 0}</span>
                    <span class="stat-label">Photos</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" style="color: var(--color-success)"
                      >{event.approved_photos || 0}</span
                    >
                    <span class="stat-label">Approved</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" style="color: var(--color-primary)"
                      >{event.pending_photos || 0}</span
                    >
                    <span class="stat-label">Pending</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value">{event.total_guests || 0}</span>
                    <span class="stat-label">Guests</span>
                  </div>
                </div>

                <div class="event-card-actions">
                  <button
                    class="btn-secondary btn-sm"
                    onclick={() => openQrModal(event)}
                  >
                    <span>📱</span> QR Code
                  </button>
                  <button
                    class="btn-secondary btn-sm"
                    onclick={() => navigate(`/event/${event.slug}/slideshow`)}
                  >
                    <span>📺</span> Slideshow
                  </button>
                  <button
                    class="btn-primary btn-sm"
                    onclick={() => viewEvent(event)}
                  >
                    Manage &rarr;
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 4. EVENT DETAIL VIEW (Host) -->
    {:else if hostView === "event_detail" && selectedEvent}
      <div class="event-detail-view">
        <button
          class="btn-secondary btn-sm"
          style="margin-bottom: 1rem;"
          onclick={() => {
            hostView = "dashboard";
            loadEvents();
          }}
        >
          &larr; Back to Events
        </button>

        {#if successMsg}
          <div class="alert-success" style="margin-bottom: 1rem;">
            ✨ {successMsg}
          </div>
        {/if}

        <div class="card detail-header-card">
          <div class="detail-header-flex">
            <div>
              <div
                style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"
              >
                <span class="event-status status-{selectedEvent.status}"
                  >{selectedEvent.status}</span
                >
                <button
                  class="btn-secondary btn-sm"
                  style="font-size: 0.75rem; padding: 0.15rem 0.6rem;"
                  onclick={handleToggleEventStatus}
                >
                  {selectedEvent.status === "active"
                    ? "🔒 Close Event"
                    : "🟢 Reopen Event"}
                </button>
              </div>

              <h2>{selectedEvent.name}</h2>
              {#if selectedEvent.tagline}
                <p class="text-secondary" style="margin-top: 0.25rem;">
                  {selectedEvent.tagline}
                </p>
              {/if}
              <p
                class="text-secondary"
                style="font-size: 0.875rem; margin-top: 0.25rem;"
              >
                Date: <strong>{selectedEvent.date}</strong> &bull; Join URL:
                <code>/event/{selectedEvent.slug}</code>
              </p>
            </div>

            <div class="detail-actions-group">
              <button
                class="btn-primary"
                onclick={() =>
                  navigate(`/event/${selectedEvent.slug}/slideshow`)}
              >
                <span>📺</span> Launch TV Slideshow
              </button>
              <button
                class="btn-secondary"
                disabled={isExportingArchive}
                onclick={() => handleExportFullArchive(selectedEvent.slug)}
                title="Full Archive: metadata.json + photos"
              >
                <span>📦</span>
                {isExportingArchive
                  ? "Packaging Archive..."
                  : "Export Full Archive"}
              </button>
              <button
                class="btn-secondary"
                disabled={isSyncingDrive}
                onclick={() => handleSyncToGoogleDrive(selectedEvent.slug)}
                title="Direct Cloud Sync to Google Drive (100+ Mode)"
              >
                <span>☁️</span>
                {isSyncingDrive
                  ? driveSyncProgress || "Syncing..."
                  : isDriveConnected
                    ? "Sync to Google Drive"
                    : "Connect Google Drive (100+ Mode)"}
              </button>
              {#if isDriveConnected && driveEventFolderUrl}
                <a
                  href={driveEventFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-secondary"
                  style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem;"
                  title="Open Event Album in Google Drive"
                >
                  <span>📁</span> Open Drive ↗
                </a>
              {/if}
              <button
                class="btn-secondary"
                onclick={() => openQrModal(selectedEvent, false)}
              >
                <span>📱</span> QR Code
              </button>
              <button
                class="btn-secondary"
                onclick={() => navigate(`/event/${selectedEvent.slug}`)}
              >
                <span>👀</span> Guest View
              </button>
              <button
                class="btn-secondary"
                style="color: var(--color-danger);"
                onclick={() => (isDeleteModalOpen = true)}
              >
                <span>🗑️</span> Delete
              </button>
            </div>
          </div>

          <!-- Host Tabs -->
          <div class="host-tabs-bar">
            <button
              class="host-tab-btn {hostDetailTab === 'queue' ? 'active' : ''}"
              onclick={() => (hostDetailTab = "queue")}
            >
              <span>Moderation Queue</span>
              {#if pendingPhotos.length > 0}
                <span class="tab-badge">{pendingPhotos.length}</span>
              {/if}
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'gallery' ? 'active' : ''}"
              onclick={() => (hostDetailTab = "gallery")}
            >
              <span>Live Gallery ({approvedPhotos.length})</span>
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'analytics'
                ? 'active'
                : ''}"
              onclick={() => {
                hostDetailTab = "analytics";
                loadAnalytics(selectedEvent.slug);
              }}
            >
              <span>📊 Analytics</span>
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'settings'
                ? 'active'
                : ''}"
              onclick={() => (hostDetailTab = "settings")}
            >
              <span>⚙️ Branding & Settings</span>
            </button>
          </div>
        </div>

        <!-- TAB 1: MODERATION QUEUE -->
        {#if hostDetailTab === "queue"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Pending Review ({pendingPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  {selectedEvent.moderation_enabled 
                    ? "Review and approve attendee photos before they appear on the live wall." 
                    : "⚡ Auto-Approve is ON: New guest photos stream directly to the live wall without manual review."}
                </p>
              </div>

              <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                <button
                  type="button"
                  class="auto-approve-toggle-btn {selectedEvent.moderation_enabled ? 'mode-manual' : 'mode-auto'}"
                  onclick={handleToggleAutoApprove}
                  title={selectedEvent.moderation_enabled 
                    ? "Turn ON Auto-Approve (All new photos stream live instantly)" 
                    : "Turn OFF Auto-Approve (Review incoming photos manually)"}
                >
                  {#if selectedEvent.moderation_enabled}
                    <span>🛡️ Auto-Approve: <strong>OFF</strong></span>
                  {:else}
                    <span>⚡ Auto-Approve: <strong>ON</strong></span>
                  {/if}
                </button>

                {#if pendingPhotos.length > 0}
                  <div class="bulk-actions">
                    <button
                      class="btn-secondary btn-sm"
                      onclick={handleBulkReject}>Reject All</button
                    >
                    <button class="btn-primary btn-sm" onclick={handleBulkApprove}
                      >Approve All ({pendingPhotos.length})</button
                    >
                  </div>
                {/if}
              </div>
            </div>

            {#if pendingPhotos.length === 0}
              <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">🎉</div>
                <h4>Queue is Clear!</h4>
                <p class="text-secondary">
                  No photos are waiting for review. New guest uploads will
                  appear here in real-time.
                </p>
              </div>
            {:else}
              <div class="moderation-grid">
                {#each pendingPhotos as photo}
                  <div class="mod-card">
                    <button
                      class="mod-thumb-btn"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={photo.thumbnail_path}
                        alt="Pending upload"
                        class="mod-thumb"
                      />
                    </button>
                    <div class="mod-body">
                      <div class="mod-author-info">
                        <strong>{photo.guest_name || "Anonymous Guest"}</strong>
                        <span
                          class="text-secondary"
                          style="font-size: 0.75rem;"
                        >
                          {new Date(photo.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div class="mod-btn-row">
                        <button
                          class="mod-btn btn-reject"
                          onclick={() => handleRejectPhoto(photo.id)}
                        >
                          Reject
                        </button>
                        <button
                          class="mod-btn btn-approve"
                          onclick={() => handleApprovePhoto(photo.id)}
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- TAB 2: LIVE GALLERY (Host View) -->
        {:else if hostDetailTab === "gallery"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Published Live Photos ({approvedPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Photos currently visible to all event attendees.
                </p>
              </div>
            </div>

            {#if approvedPhotos.length === 0}
              <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📷</div>
                <h4>No Live Photos Yet</h4>
                <p class="text-secondary">
                  Approve photos from the moderation queue to make them visible
                  here.
                </p>
              </div>
            {:else}
              <div class="moderation-grid">
                {#each approvedPhotos as photo}
                  <div class="mod-card">
                    <button
                      class="mod-thumb-btn"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={photo.thumbnail_path}
                        alt="Approved upload"
                        class="mod-thumb"
                      />
                    </button>
                    <div class="mod-body">
                      <div class="mod-author-info">
                        <strong>{photo.guest_name || "Anonymous Guest"}</strong>
                        <span class="status-pill pill-approved">🟢 Live</span>
                      </div>
                      <div style="display: flex; gap: 0.35rem; margin-top: 0.5rem;">
                        <button
                          class="btn-secondary btn-sm"
                          style="flex: 1;"
                          onclick={() => handleRevertPhoto(photo.id)}
                          title="Revert back to moderation queue"
                        >
                          ↩️ Revert
                        </button>
                        <button
                          class="btn-secondary btn-sm"
                          style="color: var(--color-danger); padding: 0.375rem 0.65rem;"
                          onclick={() => handleDeleteLivePhoto(photo.id)}
                          title="Delete photo permanently"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- TAB 3: ANALYTICS -->
        {:else if hostDetailTab === "analytics"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Event Engagement & Analytics</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Real-time metrics on guest participation, moderation ratios,
                  and storage.
                </p>
              </div>
              <button
                class="btn-secondary btn-sm"
                onclick={() => loadAnalytics(selectedEvent.slug)}
              >
                🔄 Refresh Metrics
              </button>
            </div>

            {#if !eventAnalytics}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading analytics...</p>
              </div>
            {:else}
              <div class="analytics-grid">
                <div class="analytics-stat-card">
                  <span class="analytics-num"
                    >{eventAnalytics.total_photos}</span
                  >
                  <span class="analytics-label">Total Uploads</span>
                </div>
                <div class="analytics-stat-card">
                  <span
                    class="analytics-num"
                    style="color: var(--color-success)"
                    >{eventAnalytics.approved}</span
                  >
                  <span class="analytics-label">Approved & Live</span>
                </div>
                <div class="analytics-stat-card">
                  <span
                    class="analytics-num"
                    style="color: var(--color-primary)"
                    >{eventAnalytics.unique_guests}</span
                  >
                  <span class="analytics-label">Active Guests</span>
                </div>
                <div class="analytics-stat-card">
                  <span class="analytics-num"
                    >{eventAnalytics.storage_used_mb} MB</span
                  >
                  <span class="analytics-label">Disk Storage Used</span>
                </div>
              </div>

              <!-- Top Contributors & Activity Breakdown -->
              <div class="analytics-columns">
                <div class="analytics-sub-card">
                  <h4>🏆 Top Guest Contributors</h4>
                  {#if !eventAnalytics.top_contributors || eventAnalytics.top_contributors.length === 0}
                    <p
                      class="text-secondary"
                      style="font-size: 0.875rem; margin-top: 0.5rem;"
                    >
                      No contributor data yet.
                    </p>
                  {:else}
                    <div class="contributors-list">
                      {#each eventAnalytics.top_contributors as contributor, idx}
                        <div class="contributor-row">
                          <span class="contributor-rank">#{idx + 1}</span>
                          <span class="contributor-name"
                            >{contributor.name}</span
                          >
                          <span class="contributor-count"
                            >{contributor.count} photos</span
                          >
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <div class="analytics-sub-card">
                  <h4>⏱️ Uploads by Hour</h4>
                  {#if !eventAnalytics.uploads_over_time || eventAnalytics.uploads_over_time.length === 0}
                    <p
                      class="text-secondary"
                      style="font-size: 0.875rem; margin-top: 0.5rem;"
                    >
                      No timeline activity recorded yet.
                    </p>
                  {:else}
                    <div class="timeline-bars-list">
                      {#each eventAnalytics.uploads_over_time as slot}
                        <div class="timeline-row">
                          <span class="timeline-hour">{slot.hour}</span>
                          <div class="timeline-bar-wrapper">
                            <div
                              class="timeline-bar-fill"
                              style="width: {Math.min(
                                100,
                                Math.max(
                                  8,
                                  (slot.count /
                                    (eventAnalytics.total_photos || 1)) *
                                    100,
                                ),
                              )}%"
                            ></div>
                          </div>
                          <span class="timeline-count">{slot.count}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- TAB 4: GOOGLE DRIVE BACKUP -->
        {:else if hostDetailTab === "drive"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Google Drive Cloud Backup</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Backup high-resolution approved photos to your Google Drive
                  folder.
                </p>
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                {#if driveGlobalStatus.is_connected}
                  <span class="status-pill pill-approved"
                    >🟢 {driveGlobalStatus.email || "Connected"}</span
                  >
                  <button
                    class="btn-secondary btn-sm"
                    onclick={handleDisconnectDrive}>Disconnect</button
                  >
                {:else}
                  <span
                    class="status-pill"
                    style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary);"
                    >⚪ Not Connected</span
                  >
                {/if}
              </div>
            </div>

            <div class="drive-sync-panel-grid">
              <div class="card drive-sync-stat-card">
                <span class="analytics-label">Backup Destination Folder</span>
                <strong
                  style="font-size: 1.125rem; color: var(--color-primary); display: block; margin-top: 0.25rem;"
                >
                  📁 Google Drive / Caps - {selectedEvent.name}
                </strong>

                <div
                  style="margin-top: 1.25rem; border-top: 1px solid var(--color-border); padding-top: 1rem;"
                >
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem;"
                  >
                    <span class="text-secondary">Approved Photos:</span>
                    <strong>{eventDriveSyncStatus.total_approved}</strong>
                  </div>
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem;"
                  >
                    <span class="text-secondary">Synced to Cloud:</span>
                    <strong style="color: var(--color-success)"
                      >{eventDriveSyncStatus.total_synced}</strong
                    >
                  </div>
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem;"
                  >
                    <span class="text-secondary">Pending Cloud Sync:</span>
                    <strong style="color: var(--color-primary)"
                      >{eventDriveSyncStatus.unsynced_count}</strong
                    >
                  </div>
                </div>

                <div
                  style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;"
                >
                  {#if !driveGlobalStatus.is_connected}
                    <button
                      class="btn-primary"
                      style="width: 100%;"
                      onclick={handleConnectRealGoogleDrive}
                    >
                      <span>🔗</span> Connect Google Account (OAuth)
                    </button>
                    <button
                      class="btn-secondary"
                      style="width: 100%;"
                      onclick={handleMockConnectDrive}
                    >
                      <span>⚡</span> Fast Testing Mode (Simulated Sync)
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      style="width: 100%; font-size: 0.8125rem;"
                      onclick={() => (isDriveCredentialsModalOpen = true)}
                    >
                      <span>⚙️</span> Configure Google OAuth Keys
                    </button>
                  {:else if eventDriveSyncStatus.total_approved === 0}
                    <div
                      class="empty-state"
                      style="padding: 1rem; border: 1px dashed var(--color-border); border-radius: var(--radius-md); font-size: 0.875rem; background: var(--color-surface);"
                    >
                      ℹ️ No approved photos yet! Go to the <strong
                        >Moderation Queue</strong
                      >
                      tab and click <strong>Approve</strong> on photos before syncing.
                    </div>
                  {:else if eventDriveSyncStatus.unsynced_count === 0}
                    <div
                      style="padding: 0.75rem 1rem; background: #ECFDF5; border: 1px solid #10B981; color: #065F46; border-radius: var(--radius-md); font-size: 0.875rem; text-align: center; font-weight: 600;"
                    >
                      ✅ All {eventDriveSyncStatus.total_approved} approved photos
                      are backed up to Google Drive!
                    </div>
                  {:else}
                    <button
                      class="btn-primary"
                      style="width: 100%;"
                      disabled={isSyncingDrive}
                      onclick={handleTriggerDriveSync}
                    >
                      <span>☁️</span>
                      {isSyncingDrive
                        ? syncProgressText ||
                          "Syncing Photos to Google Drive..."
                        : `Sync ${eventDriveSyncStatus.unsynced_count} Photos to Drive`}
                    </button>
                  {/if}
                </div>
              </div>

              <div class="card drive-sync-info-card">
                <h4>Drive Sync Features</h4>
                <ul class="drive-features-list">
                  <li>
                    ✅ <strong>Incremental Sync</strong>: Only newly approved
                    photos are uploaded.
                  </li>
                  <li>
                    ✅ <strong>Original Quality</strong>: Preserves
                    full-resolution camera captures.
                  </li>
                  <li>
                    ✅ <strong>Automatic Organization</strong>: Files are stored
                    under <code>Caps - {selectedEvent.name}</code>.
                  </li>
                  <li>
                    ✅ <strong>Drive Sync Log</strong>: Every upload is tracked
                    in the local database.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- TAB 5: SLIDESHOW & SETTINGS -->
        {:else if hostDetailTab === "settings"}
          <div class="card moderation-panel">
            <h3 style="margin-bottom: 1.25rem;">Event Branding & Identity</h3>

            <!-- Custom Logo & Tagline Editor -->
            <div
              style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.75rem; max-width: 540px;"
            >
              <h4 style="margin-bottom: 0.75rem;">Custom Event Logo</h4>
              <div
                style="display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.25rem;"
              >
                {#if selectedEvent.logo}
                  <div
                    style="background: white; border: 1px solid var(--color-border); padding: 0.5rem; border-radius: var(--radius-md);"
                  >
                    <img
                      src={selectedEvent.logo}
                      alt="Event logo"
                      style="max-height: 50px; max-width: 140px; object-fit: contain;"
                    />
                  </div>
                {:else}
                  <div
                    style="width: 50px; height: 50px; background: var(--color-primary-light); color: var(--color-primary); display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); font-size: 1.5rem;"
                  >
                    📸
                  </div>
                {/if}

                <div style="display: flex; gap: 0.5rem;">
                  <input
                    type="file"
                    accept="image/*"
                    bind:this={logoFileInputEl}
                    onchange={handleLogoUpload}
                    style="display: none;"
                  />
                  <button
                    class="btn-secondary btn-sm"
                    disabled={isUploadingLogo}
                    onclick={() => logoFileInputEl?.click()}
                  >
                    <span>🖼️</span>
                    {isUploadingLogo
                      ? "Uploading..."
                      : selectedEvent.logo
                        ? "Change Logo"
                        : "Upload Logo"}
                  </button>
                  {#if selectedEvent.logo}
                    <button
                      class="btn-secondary btn-sm"
                      style="color: var(--color-danger);"
                      onclick={handleRemoveLogo}
                    >
                      Remove
                    </button>
                  {/if}
                </div>
              </div>

              <div>
                <label class="form-label" for="eventTaglineEdit"
                  >Event Tagline</label
                >
                <div style="display: flex; gap: 0.5rem;">
                  <input
                    id="eventTaglineEdit"
                    type="text"
                    class="input-field"
                    placeholder="e.g. New Event"
                    bind:value={selectedEvent.tagline}
                  />
                  <button
                    class="btn-primary btn-sm"
                    onclick={handleSaveBranding}
                  >
                    Save Tagline
                  </button>
                </div>
              </div>
            </div>

            <!-- Event Rules & Upload Limits -->
            <div
              style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.75rem; max-width: 540px;"
            >
              <h4 style="margin-bottom: 0.75rem;">Event Rules & Limits</h4>
              
              <div class="form-stack">
                <div>
                  <label class="form-label" for="eventLimitInput">Per-Guest Upload Limit (photos)</label>
                  <input
                    id="eventLimitInput"
                    type="number"
                    min="1"
                    max="500"
                    class="input-field"
                    bind:value={selectedEvent.guest_upload_limit}
                  />
                  <span class="helper-text">Number of photos each attendee is allowed to share.</span>
                </div>

                <div class="checkbox-row" style="margin-top: 0.5rem;">
                  <input
                    id="eventModToggle"
                    type="checkbox"
                    bind:checked={selectedEvent.moderation_enabled}
                  />
                  <label for="eventModToggle">
                    <strong>Enable Live Photo Moderation</strong>
                    <span class="helper-text">When checked, photos require admin approval before appearing on the live wall.</span>
                  </label>
                </div>

                <div class="checkbox-row">
                  <input
                    id="eventExifToggle"
                    type="checkbox"
                    bind:checked={selectedEvent.exif_strip}
                  />
                  <label for="eventExifToggle">
                    <strong>Strip GPS & EXIF Metadata</strong>
                    <span class="helper-text">Removes GPS location and private camera metadata for attendee privacy.</span>
                  </label>
                </div>

                <button
                  type="button"
                  class="btn-primary btn-sm"
                  style="align-self: flex-start; margin-top: 0.75rem;"
                  onclick={handleSaveEventSettings}
                >
                  Save Limit & Rules
                </button>
              </div>
            </div>

            <h3 style="margin-bottom: 1.25rem;">Slideshow Display Settings</h3>

            <form
              onsubmit={(e) => {
                e.preventDefault();
                handleSaveSlideshowConfig();
              }}
              class="form-stack"
              style="max-width: 540px;"
            >
              <div class="form-row">
                <div>
                  <label class="form-label" for="slideInterval"
                    >Slide Interval (seconds)</label
                  >
                  <input
                    id="slideInterval"
                    type="number"
                    min="2"
                    max="60"
                    class="input-field"
                    bind:value={selectedEvent.slideshow_interval}
                  />
                </div>
                <div>
                  <label class="form-label" for="slideTrans"
                    >Transition Style</label
                  >
                  <select
                    id="slideTrans"
                    class="input-field"
                    bind:value={selectedEvent.slideshow_transition}
                  >
                    <option value="fade">Smooth Fade</option>
                    <option value="slide">Horizontal Slide</option>
                    <option value="zoom">Ken Burns Zoom</option>
                  </select>
                </div>
              </div>

              <div class="checkbox-row">
                <input
                  id="slideQrToggle"
                  type="checkbox"
                  bind:checked={selectedEvent.slideshow_show_qr}
                />
                <label for="slideQrToggle">
                  <strong>Show Picture-in-Picture QR Code</strong>
                  <span class="helper-text"
                    >Displays a small QR in the corner so venue attendees can
                    scan while watching.</span
                  >
                </label>
              </div>

              <div class="checkbox-row">
                <input
                  id="slideAuthorToggle"
                  type="checkbox"
                  bind:checked={selectedEvent.slideshow_show_author}
                />
                <label for="slideAuthorToggle">
                  <strong>Show "Captured by [Name]" attribution overlay</strong>
                  <span class="helper-text"
                    >Displays subtle attendee name on slide.</span
                  >
                </label>
              </div>

              <button
                type="submit"
                class="btn-primary"
                style="align-self: flex-start; margin-top: 0.5rem;"
              >
                Save Slideshow Settings
              </button>
            </form>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- DELETE EVENT CONFIRMATION MODAL -->
  {#if isDeleteModalOpen && selectedEvent}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isDeleteModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isDeleteModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3 style="color: var(--color-danger);">Delete Event Space</h3>
          <button class="close-btn" onclick={() => (isDeleteModalOpen = false)}
            >&times;</button
          >
        </div>

        <p
          class="text-secondary"
          style="font-size: 0.9375rem; margin-bottom: 1rem;"
        >
          This will permanently delete <strong>{selectedEvent.name}</strong>,
          along with all original photos, thumbnails, and guest records from the
          disk. This cannot be undone.
        </p>

        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleDeleteEvent();
          }}
          class="form-stack"
        >
          <div>
            <label class="form-label" for="confirmName">
              Type <strong>{selectedEvent.name}</strong> to confirm:
            </label>
            <input
              id="confirmName"
              type="text"
              class="input-field"
              placeholder={selectedEvent.name}
              bind:value={deleteConfirmInput}
              required
            />
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isDeleteModalOpen = false)}>Cancel</button
            >
            <button
              type="submit"
              class="btn-primary"
              style="background: var(--color-danger); border-color: var(--color-danger);"
              disabled={deleteConfirmInput !== selectedEvent.name ||
                isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Permanently Delete Event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- PHOTO PREVIEW LIGHTBOX -->
  {#if selectedPreviewPhoto}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (selectedPreviewPhoto = null)}
      onkeydown={(e) => {
        if (e.key === "Escape") selectedPreviewPhoto = null;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lightbox-card" onclick={(e) => e.stopPropagation()}>
        <div class="lightbox-header">
          <div>
            <strong>Photo Preview</strong>
            {#if selectedPreviewPhoto.status === "pending"}
              <span
                class="status-pill pill-pending"
                style="margin-left: 0.5rem;">🟡 Pending Review</span
              >
            {:else if selectedPreviewPhoto.status === "approved"}
              <span
                class="status-pill pill-approved"
                style="margin-left: 0.5rem;">🟢 Live</span
              >
            {/if}
            {#if selectedPreviewPhoto.guest_name}
              <span
                class="text-secondary"
                style="margin-left: 0.5rem; font-size: 0.8125rem;"
                >by {selectedPreviewPhoto.guest_name}</span
              >
            {/if}
          </div>
          <button
            class="close-btn"
            onclick={() => (selectedPreviewPhoto = null)}>&times;</button
          >
        </div>

        <div class="lightbox-img-wrapper">
          <img
            src={selectedPreviewPhoto.original_path}
            alt="Full resolution capture"
            class="lightbox-img"
          />
        </div>

        <div class="lightbox-footer">
          <div style="display: flex; gap: 0.75rem;">
            {#if isGuestRoute && guestSession && (selectedPreviewPhoto.guest_id === guestSession.guest.id || selectedPreviewPhoto.guest_name === guestSession.guest.name)}
              <button
                class="btn-secondary btn-sm"
                style="color: var(--color-danger); border-color: var(--color-danger);"
                onclick={() => handleDeleteOwnPhoto(selectedPreviewPhoto.id, selectedPreviewPhoto)}
              >
                🗑️ Delete Photo
              </button>
            {/if}
            <a
              href={selectedPreviewPhoto.original_path ||
                selectedPreviewPhoto.original_url}
              download={selectedPreviewPhoto.filename}
              class="btn-primary btn-sm"
            >
              <span>💾</span> Download Full-Res Original
            </a>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- CREATE EVENT MODAL -->
  {#if isCreateModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isCreateModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isCreateModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Create Event Space</h3>
          <button class="close-btn" onclick={() => (isCreateModalOpen = false)}
            >&times;</button
          >
        </div>

        {#if errorMsg}
          <div class="alert-error" style="margin-bottom: 1rem;">{errorMsg}</div>
        {/if}

        <form onsubmit={handleCreateEvent} class="form-stack">
          <div>
            <label class="form-label" for="eventName">Event Name *</label>
            <input
              id="eventName"
              type="text"
              class="input-field"
              placeholder="New Event"
              bind:value={newEvent.name}
              required
            />
          </div>

          <div class="form-row">
            <div>
              <label class="form-label" for="eventDate">Date</label>
              <input
                id="eventDate"
                type="date"
                class="input-field"
                bind:value={newEvent.date}
              />
            </div>
            <div>
              <label class="form-label" for="uploadLimit"
                >Per-Guest Upload Limit</label
              >
              <input
                id="uploadLimit"
                type="number"
                min="1"
                max="200"
                class="input-field"
                bind:value={newEvent.guest_upload_limit}
              />
            </div>
          </div>

          <div>
            <label class="form-label" for="eventTagline"
              >Tagline / Subtitle (optional)</label
            >
            <input
              id="eventTagline"
              type="text"
              class="input-field"
              placeholder="e.g. New Event"
              bind:value={newEvent.tagline}
            />
          </div>

          <div class="checkbox-row">
            <input
              id="modToggle"
              type="checkbox"
              bind:checked={newEvent.moderation_enabled}
            />
            <label for="modToggle">
              <strong>Enable photo moderation queue</strong>
              <span class="helper-text"
                >You must approve photos before they appear on the live gallery.</span
              >
            </label>
          </div>

          <div class="checkbox-row">
            <input
              id="exifToggle"
              type="checkbox"
              bind:checked={newEvent.exif_strip}
            />
            <label for="exifToggle">
              <strong>Strip EXIF metadata (GPS location & device info)</strong>
              <span class="helper-text">Recommended for attendee privacy.</span>
            </label>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isCreateModalOpen = false)}>Cancel</button
            >
            <button type="submit" class="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Event Space"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- HOST PROFILE & SECURITY MODAL -->
  {#if isProfileModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isProfileModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isProfileModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>👤 Host Profile & Security Settings</h3>
          <button class="close-btn" onclick={() => (isProfileModalOpen = false)}
            >&times;</button
          >
        </div>

        {#if profileErrorMsg}
          <div class="alert alert-error" style="margin-bottom: 1rem;">
            {profileErrorMsg}
          </div>
        {/if}

        <form onsubmit={handleSaveProfile} class="form-stack">
          <div>
            <label class="form-label" for="editHostName"
              >Host Name / Role</label
            >
            <input
              id="editHostName"
              type="text"
              class="input-field"
              placeholder="e.g. Pastor John / Media Team"
              bind:value={editHostName}
              required
            />
            <span class="helper-text"
              >This name is shown across host controls and management headers.</span
            >
          </div>

          <div style="border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 0.5rem;">
            <h4 style="font-size: 0.9375rem; margin-bottom: 0.5rem; font-weight: 600;">Change Admin PIN (Optional)</h4>
            <div>
              <label class="form-label" for="currentPin"
                >Current Admin PIN</label
              >
              <input
                id="currentPin"
                type="password"
                class="input-field"
                placeholder="Enter current PIN"
                maxlength="8"
                bind:value={currentPinInput}
              />
              <span class="helper-text"
                >Required only if you are setting a new PIN.</span
              >
            </div>

            <div style="margin-top: 0.75rem;">
              <label class="form-label" for="newPin">New Admin PIN</label>
              <input
                id="newPin"
                type="password"
                class="input-field"
                placeholder="Leave blank to keep current PIN"
                maxlength="8"
                bind:value={newPinInput}
              />
            </div>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isProfileModalOpen = false)}>Cancel</button
            >
            <button type="submit" class="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- QR CODE MODAL & PROJECTION MODE -->
  {#if isQrModalOpen && selectedEvent}
    <div
      class="modal-backdrop {isProjectionMode ? 'projection-backdrop' : ''}"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isQrModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isQrModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="modal-card {isProjectionMode ? 'projection-card' : 'qr-card'}"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <div>
            {#if selectedEvent.logo}
              <div style="margin-bottom: 0.75rem;">
                <img
                  src={selectedEvent.logo}
                  alt="Event logo"
                  style="max-height: 60px; max-width: 160px; object-fit: contain;"
                />
              </div>
            {/if}
            <h3 style="font-size: {isProjectionMode ? '2rem' : '1.25rem'};">
              {selectedEvent.name}
            </h3>
            {#if selectedEvent.tagline}
              <p class="text-secondary">{selectedEvent.tagline}</p>
            {/if}
          </div>
          <button class="close-btn" onclick={() => (isQrModalOpen = false)}
            >&times;</button
          >
        </div>

        <div class="qr-content-wrapper">
          {#if qrData}
            <div
              class="qr-image-container {isProjectionMode
                ? 'projection-qr'
                : ''}"
            >
              <img
                src={qrData.qr_data_url}
                alt="Event QR Code"
                class="qr-img"
              />
            </div>

            <div class="qr-info-block">
              <p class="qr-instruction">
                📱 <strong>Scan with any phone camera to share photos</strong>
              </p>
              <p class="qr-url-badge">{qrData.join_url}</p>
            </div>

            {#if !isProjectionMode}
              <div class="modal-footer qr-modal-footer">
                <a
                  href={qrData.qr_data_url}
                  download="caps-qr-{selectedEvent.slug}.png"
                  class="btn-secondary"
                >
                  <span>💾</span> Download PNG
                </a>
                <button
                  class="btn-primary"
                  onclick={() => (isProjectionMode = true)}
                >
                  <span>📺</span> Full-Screen TV Mode
                </button>
              </div>
            {/if}
          {:else}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Generating QR Code...</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .slideshow-mode-container {
    background: #000;
    overflow: hidden;
  }

  .app-header {
    background: white;
    border-bottom: 1px solid var(--color-border);
    padding: 0.875rem 1.5rem;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-inner {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .logo-icon {
    font-size: 1.75rem;
    background: var(--color-primary-light);
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
  }

  .brand-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-primary);
    line-height: 1.1;
  }

  .brand-subtitle {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .install-pwa-btn {
    background: #10b981;
    color: white;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    animation: pulseGlow 2.5s infinite;
  }

  @keyframes pulseGlow {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
    }
  }

  .offline-status-pill {
    font-size: 0.75rem;
    font-weight: 700;
    color: #991b1b;
    background: #fee2e2;
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-pill);
    border: 1px solid #fecaca;
  }

  .drive-connected-pill {
    font-size: 0.75rem;
    font-weight: 600;
    color: #065f46;
    background: #d1fae5;
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-pill);
  }

  .host-badge {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    background: var(--color-surface);
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
  }

  .guest-pill {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary-dark);
    background: var(--color-primary-light);
    padding: 0.375rem 0.875rem;
    border-radius: var(--radius-pill);
  }

  .main-content {
    flex: 1;
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .slideshow-main {
    max-width: 100vw;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  .slideshow-stage {
    position: relative;
    width: 100vw;
    height: 100vh;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .slide-item-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .slide-img {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* Transition Animations */
  .transition-fade {
    animation: fadeIn 0.8s ease-in-out;
  }

  .transition-slide {
    animation: slideIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .transition-zoom {
    animation: kenBurns 6s ease-out forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes kenBurns {
    0% {
      transform: scale(1);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      transform: scale(1.08);
      opacity: 1;
    }
  }

  .slideshow-author-badge {
    position: absolute;
    bottom: 2rem;
    left: 2rem;
    background: rgba(0, 0, 0, 0.65);
    color: white;
    backdrop-filter: blur(8px);
    padding: 0.625rem 1.25rem;
    border-radius: var(--radius-pill);
    font-size: 1.125rem;
    z-index: 10;
    pointer-events: none;
  }

  .slideshow-qr-pip {
    position: absolute;
    bottom: 2rem;
    right: 2rem;
    background: rgba(255, 255, 255, 0.95);
    padding: 0.75rem;
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    text-align: center;
    z-index: 10;
    pointer-events: none;
  }

  .pip-qr-img {
    width: 130px;
    height: 130px;
    display: block;
  }

  .pip-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 700;
    color: #111827;
    margin-top: 0.375rem;
  }

  .slideshow-controls-overlay {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    display: flex;
    gap: 0.75rem;
    opacity: 0;
    transition: opacity 0.2s ease;
    z-index: 20;
  }

  .slideshow-stage:hover .slideshow-controls-overlay {
    opacity: 1;
  }

  .slide-ctrl-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .slide-ctrl-btn:hover {
    background: rgba(37, 99, 235, 0.9);
  }

  .slideshow-empty {
    text-align: center;
    color: white;
    max-width: 500px;
    padding: 2rem;
  }

  .slideshow-logo {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .slideshow-tagline {
    color: #9ca3af;
    font-size: 1.25rem;
    margin-top: 0.5rem;
  }

  .slideshow-waiting {
    color: #60a5fa;
    margin-top: 1.5rem;
    font-size: 1.125rem;
  }

  .slideshow-empty-qr {
    margin-top: 2rem;
    background: white;
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    display: inline-block;
    color: #111827;
  }

  .empty-qr-img {
    width: 180px;
    height: 180px;
    display: block;
    margin: 0 auto 0.75rem auto;
  }

  .alert-success {
    background: var(--color-success-bg);
    color: var(--color-success);
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .alert-archived-banner {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
    padding: 0.875rem 1.25rem;
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    margin-bottom: 1rem;
    text-align: left;
  }

  .auth-card {
    max-width: 440px;
    margin: 4rem auto;
    padding: 2.5rem;
    text-align: center;
  }

  .guest-join-card {
    margin: 2rem auto;
    box-shadow: var(--shadow-lg);
  }

  .event-badge-top {
    display: inline-block;
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-pill);
    margin-bottom: 0.75rem;
  }

  .event-hero-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--color-text);
    line-height: 1.2;
  }

  .event-hero-tagline {
    font-size: 1rem;
    color: var(--color-text-secondary);
    margin-top: 0.375rem;
  }

  .event-hero-date {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary);
    margin-top: 0.5rem;
  }

  .join-divider {
    height: 1px;
    background: var(--color-border);
    margin: 1.5rem 0;
  }

  .guest-join-footer {
    margin-top: 1.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .btn-lg {
    padding: 0.875rem 1.5rem;
    font-size: 1.0625rem;
    width: 100%;
  }

  .guest-space-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .event-banner-card {
    padding: 1.75rem;
  }

  .event-banner-flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 1.25rem;
  }

  .quota-badge {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0.75rem 1.25rem;
    border-radius: var(--radius-md);
    text-align: center;
  }

  .quota-count {
    display: block;
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--color-primary);
  }

  .quota-label {
    font-size: 0.6875rem;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .guest-action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1.25rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .action-buttons-group {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .quota-helper {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .auto-approve-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.875rem;
    border-radius: var(--radius-pill);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .auto-approve-toggle-btn.mode-auto {
    background: #ecfdf5;
    color: #065f46;
    border-color: #a7f3d0;
  }

  .auto-approve-toggle-btn.mode-auto:hover {
    background: #d1fae5;
    border-color: #6ee7b7;
  }

  .auto-approve-toggle-btn.mode-manual {
    background: #f8fafc;
    color: #475569;
    border-color: #cbd5e1;
  }

  .auto-approve-toggle-btn.mode-manual:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .batch-upload-banner {
    width: 100%;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: var(--radius-md);
    padding: 0.875rem 1.125rem;
    margin-top: 0.75rem;
    animation: fadeIn 0.2s ease-out;
  }

  .batch-upload-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .batch-upload-title {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    color: #166534;
    font-size: 0.9375rem;
    font-weight: 700;
  }

  .batch-upload-percent {
    font-size: 0.8125rem;
    font-weight: 800;
    color: #15803d;
    background: #dcfce7;
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-pill);
    border: 1px solid #bbf7d0;
  }

  .batch-progress-track {
    width: 100%;
    height: 8px;
    background: #dcfce7;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 0.4rem;
  }

  .batch-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #16a34a);
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .batch-upload-status {
    font-size: 0.8125rem;
    color: #166534;
    margin: 0;
    font-weight: 500;
  }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-primary);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .uploads-section {
    padding: 1.5rem;
  }

  .section-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .uploads-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.875rem;
  }

  .upload-item-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0;
  }

  .upload-thumb-click {
    width: 100%;
    height: 100%;
    padding: 0;
    cursor: pointer;
    background: transparent;
  }

  .upload-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .upload-badge-overlay {
    position: absolute;
    bottom: 6px;
    left: 6px;
  }

  .delete-photo-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    line-height: 1;
    transition: background 0.15s ease;
  }

  .delete-photo-btn:hover {
    background: var(--color-danger);
  }

  .status-pill {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.6875rem;
    font-weight: 700;
    backdrop-filter: blur(4px);
  }

  .pill-pending {
    background: rgba(254, 240, 138, 0.9);
    color: #854d0e;
  }

  .pill-approved {
    background: rgba(209, 250, 229, 0.9);
    color: #065f46;
  }

  .pill-rejected {
    background: rgba(254, 226, 226, 0.9);
    color: #991b1b;
  }

  .gallery-section {
    padding: 1.75rem;
  }

  .gallery-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .gallery-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .selection-toolbar {
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
    padding: 0.75rem 1.25rem;
    border-radius: var(--radius-md);
    margin-bottom: 1.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .live-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
  }

  .gallery-item-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .gallery-item-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .selected-card {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  .select-checkbox-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
  }

  .select-checkbox-overlay input {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .gallery-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gallery-info-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.5rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .gallery-author {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-dot-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-success);
    background: var(--color-success-bg);
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-pill);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--color-success);
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.8);
    }
  }

  .empty-gallery {
    text-align: center;
    padding: 3.5rem 1.5rem;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border);
  }

  .auth-icon {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }

  .form-stack {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
    text-align: left;
  }

  .form-label {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.375rem;
    color: var(--color-text);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  .checkbox-row input {
    margin-top: 0.25rem;
  }

  .helper-text {
    display: block;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .alert-error {
    background: var(--color-danger-bg);
    color: var(--color-danger);
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .dashboard-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .drive-banner-card {
    background: linear-gradient(135deg, #f0fdf4, #eff6ff);
    border: 1px solid #bfdbfe;
    padding: 1.25rem 1.5rem;
  }

  .drive-banner-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .drive-logo {
    font-size: 2rem;
  }

  .events-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.25rem;
  }

  .text-left {
    text-align: left;
  }

  .event-card {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 100%;
  }

  .event-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
  }

  .event-status {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    margin-bottom: 0.5rem;
  }

  .status-active {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .status-archived {
    background: #e5e7eb;
    color: #4b5563;
  }

  .event-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .event-tagline {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin-top: 0.25rem;
  }

  .event-date {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    font-weight: 500;
    white-space: nowrap;
  }

  .event-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    padding: 0.75rem;
    margin: 1.25rem 0;
    text-align: center;
    width: 100%;
  }

  .stat-value {
    display: block;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .stat-label {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    font-weight: 600;
  }

  .event-card-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    border-top: 1px solid var(--color-border);
    padding-top: 0.875rem;
    width: 100%;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .detail-header-card {
    padding: 2rem;
  }

  .detail-header-flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  .detail-actions-group {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .host-tabs-bar {
    display: flex;
    gap: 0.5rem;
    margin-top: 1.5rem;
    border-bottom: 1px solid var(--color-border);
  }

  .host-tab-btn {
    padding: 0.75rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    border-bottom: 2px solid transparent;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.15s ease;
  }

  .host-tab-btn.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }

  .tab-badge {
    background: var(--color-primary);
    color: white;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-pill);
  }

  .moderation-panel {
    margin-top: 1.5rem;
    padding: 1.75rem;
  }

  .panel-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .bulk-actions {
    display: flex;
    gap: 0.75rem;
  }

  .moderation-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1.25rem;
  }

  .mod-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .mod-thumb-btn {
    width: 100%;
    aspect-ratio: 4/3;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: #000;
  }

  .mod-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.15s ease;
  }

  .mod-thumb-btn:hover .mod-thumb {
    transform: scale(1.03);
  }

  .mod-body {
    padding: 0.875rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex: 1;
  }

  .mod-author-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .mod-btn-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .mod-btn {
    padding: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: var(--radius-sm);
    text-align: center;
  }

  .btn-approve {
    background: var(--color-success);
    color: white;
  }

  .btn-approve:hover {
    background: #059669;
  }

  .btn-reject {
    background: white;
    color: var(--color-danger);
    border: 1px solid var(--color-danger);
  }

  .btn-reject:hover {
    background: var(--color-danger-bg);
  }

  /* Analytics Dashboard Styles */
  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.75rem;
  }

  .analytics-stat-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.25rem;
    text-align: center;
  }

  .analytics-num {
    display: block;
    font-size: 2rem;
    font-weight: 800;
    color: var(--color-text);
  }

  .analytics-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-top: 0.25rem;
  }

  .analytics-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .analytics-sub-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.25rem;
  }

  .contributors-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .contributor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: white;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
  }

  .contributor-rank {
    font-weight: 700;
    color: var(--color-primary);
    width: 24px;
  }

  .contributor-name {
    flex: 1;
    font-weight: 600;
    color: var(--color-text);
  }

  .contributor-count {
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .timeline-bars-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .timeline-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8125rem;
  }

  .timeline-hour {
    width: 48px;
    font-family: monospace;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .timeline-bar-wrapper {
    flex: 1;
    background: #e5e7eb;
    height: 12px;
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .timeline-bar-fill {
    background: var(--color-primary);
    height: 100%;
    border-radius: var(--radius-pill);
  }

  .timeline-count {
    font-weight: 700;
    width: 28px;
    text-align: right;
  }

  /* Drive Sync Tab Styles */
  .drive-sync-panel-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .drive-sync-stat-card {
    padding: 1.5rem;
  }

  .drive-sync-info-card {
    padding: 1.5rem;
    background: var(--color-surface);
  }

  .drive-features-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .projection-backdrop {
    background: rgba(17, 24, 39, 0.95);
  }

  .modal-card {
    background: white;
    width: 100%;
    max-width: 520px;
    border-radius: var(--radius-lg);
    padding: 2rem;
    box-shadow: var(--shadow-lg);
  }

  .qr-card {
    max-width: 480px;
    text-align: center;
  }

  .projection-card {
    max-width: 680px;
    padding: 3rem;
    text-align: center;
    background: white;
    border-radius: 24px;
  }

  .lightbox-card {
    background: white;
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    max-width: 720px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }

  .lightbox-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .lightbox-img-wrapper {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    border-radius: var(--radius-md);
  }

  .lightbox-img {
    max-width: 100%;
    max-height: 65vh;
    object-fit: contain;
  }

  .lightbox-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }

  .qr-content-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 1rem;
  }

  .qr-image-container {
    background: white;
    padding: 1rem;
    border: 2px solid var(--color-border);
    border-radius: var(--radius-lg);
    display: inline-block;
    box-shadow: var(--shadow-md);
  }

  .projection-qr {
    padding: 1.5rem;
    border-width: 4px;
    border-color: var(--color-primary);
  }

  .qr-img {
    width: 220px;
    height: 220px;
    display: block;
  }

  .projection-qr .qr-img {
    width: 320px;
    height: 320px;
  }

  .qr-info-block {
    margin: 1.25rem 0 1rem 0;
  }

  .qr-instruction {
    font-size: 1.0625rem;
    color: var(--color-text);
  }

  .qr-url-badge {
    display: inline-block;
    font-family: monospace;
    font-size: 0.9375rem;
    color: var(--color-primary-dark);
    background: var(--color-primary-light);
    padding: 0.375rem 0.875rem;
    border-radius: var(--radius-pill);
    margin-top: 0.5rem;
  }

  .qr-network-selector {
    width: 100%;
    margin-top: 1rem;
    text-align: left;
  }

  .network-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .net-btn {
    padding: 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .net-btn.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
  }

  .qr-modal-footer {
    display: flex;
    justify-content: center;
    gap: 1rem;
    width: 100%;
    margin-top: 1.5rem;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .close-btn {
    font-size: 1.5rem;
    color: var(--color-text-secondary);
    line-height: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .btn-sm {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
  }

  .loading-state {
    text-align: center;
    margin-top: 4rem;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem auto;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* ========================================== */
  /* ANALYTICS STYLES                           */
  /* ========================================== */
  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.25rem;
    margin-bottom: 2rem;
  }

  .analytics-stat-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.5rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .analytics-num {
    font-size: 2rem;
    font-weight: 800;
    line-height: 1.1;
    color: var(--color-text);
  }

  .analytics-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .analytics-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  .analytics-sub-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
  }

  .analytics-sub-card h4 {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--color-text);
  }

  .contributors-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .contributor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: white;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
  }

  .contributor-rank {
    font-weight: 700;
    color: var(--color-primary);
    width: 28px;
  }

  .contributor-name {
    font-weight: 600;
    flex: 1;
    margin: 0 0.5rem;
    color: var(--color-text);
  }

  .contributor-count {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .timeline-bars-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .timeline-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8125rem;
  }

  .timeline-hour {
    width: 70px;
    color: var(--color-text-secondary);
    font-weight: 500;
    text-align: right;
  }

  .timeline-bar-wrapper {
    flex: 1;
    background: #e5e7eb;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
  }

  .timeline-bar-fill {
    background: var(--color-primary);
    height: 100%;
    border-radius: 6px;
    transition: width 0.3s ease;
  }

  .timeline-count {
    width: 30px;
    font-weight: 600;
    color: var(--color-text);
  }
</style>
