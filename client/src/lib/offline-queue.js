import { api } from './api.js';

const DB_NAME = 'caps_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'upload_queue';

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('slug', 'slug', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    req.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

/**
 * Add a photo upload to the offline IndexedDB queue
 */
export async function enqueueOfflinePhoto(slug, file, guestToken) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const item = {
      slug,
      file,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      guestToken,
      timestamp: Date.now()
    };

    const req = store.add(item);
    req.onsuccess = () => resolve({ id: req.result, ...item });
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all queued uploads for an event slug
 */
export async function getOfflineQueue(slug) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const items = (req.result || []).filter(item => !slug || item.slug === slug);
        resolve(items);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  } catch {
    return [];
  }
}

/**
 * Remove an item from the offline queue
 */
export async function removeOfflinePhoto(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Flush and upload queued photos sequentially
 */
export async function flushOfflineQueue(slug, onProgress = () => {}, onPhotoUploaded = () => {}) {
  const items = await getOfflineQueue(slug);
  if (!items.length) return { uploaded: 0, failed: 0 };

  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress({ current: i + 1, total: items.length, fileName: item.fileName });

    try {
      const res = await api.uploadPhoto(item.slug, item.file, item.guestToken);
      await removeOfflinePhoto(item.id);
      uploaded++;
      onPhotoUploaded(res);
    } catch (err) {
      console.warn(`Failed to upload queued photo ${item.fileName}:`, err);
      // If error indicates permanent problem (e.g. quota or archived), remove
      if (err.message && (err.message.includes('Quota') || err.message.includes('archived'))) {
        await removeOfflinePhoto(item.id);
      }
      failed++;
    }
  }

  return { uploaded, failed, total: items.length };
}
