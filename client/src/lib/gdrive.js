import { db } from './db.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_RESUMABLE_INIT_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';

let tokenClient = null;
const folderCache = new Map();

export function getStoredDriveToken() {
  const token = localStorage.getItem('caps_gdrive_token');
  const expiry = localStorage.getItem('caps_gdrive_token_expiry');
  if (token && expiry && Date.now() < parseInt(expiry, 10)) {
    return token;
  }
  return null;
}

export function setStoredDriveToken(token, expiresIn = 3600) {
  if (token) {
    localStorage.setItem('caps_gdrive_token', token);
    localStorage.setItem('caps_gdrive_token_expiry', String(Date.now() + expiresIn * 1000));
  } else {
    localStorage.removeItem('caps_gdrive_token');
    localStorage.removeItem('caps_gdrive_token_expiry');
  }
}

export function disconnectGoogleDrive() {
  const token = getStoredDriveToken();
  if (token && typeof google !== 'undefined' && google?.accounts?.oauth2) {
    try {
      google.accounts.oauth2.revoke(token, () => {});
    } catch (_) {}
  }
  setStoredDriveToken(null);
  folderCache.clear();
}

/**
 * Initialize Google Identity Services (GIS) Token Client
 */
export function requestGoogleDriveAuth(clientId) {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      return reject(new Error('Google Identity Services SDK not loaded'));
    }

    if (!clientId) {
      return reject(new Error('Google OAuth Client ID is required. Enter it in Settings.'));
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          return reject(new Error(tokenResponse.error_description || tokenResponse.error));
        }
        if (tokenResponse.access_token) {
          setStoredDriveToken(tokenResponse.access_token, tokenResponse.expires_in || 3600);
          resolve(tokenResponse.access_token);
        } else {
          reject(new Error('Failed to retrieve access token from Google'));
        }
      }
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/**
 * Find or create a folder in Google Drive
 */
export async function findOrCreateFolder(folderName, parentFolderId = 'root') {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const cacheKey = `${parentFolderId}::${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  // Search if folder already exists
  const query = `name = '${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    const id = searchData.files[0].id;
    folderCache.set(cacheKey, id);
    return id;
  }

  // Create folder
  const createRes = await fetch(DRIVE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    })
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(createData.error?.message || 'Failed to create Drive folder');
  }

  folderCache.set(cacheKey, createData.id);
  return createData.id;
}

/**
 * Make a Google Drive folder publicly viewable (anyone with link can view)
 */
export async function makeFolderPublicView(folderId) {
  const token = getStoredDriveToken();
  if (!token) return;

  try {
    await fetch(`${DRIVE_API_URL}/${folderId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
        allowFileDiscovery: false
      })
    });
  } catch (err) {
    console.warn('Could not set public permission on Drive folder:', err);
  }
}

/**
 * Setup complete hierarchy for an event in Google Drive
 */
export async function setupEventDriveHierarchy(slug, eventName) {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const rootFolderId = await findOrCreateFolder('EventCaps Events', 'root');
  const eventFolderId = await findOrCreateFolder(eventName || slug, rootFolderId);
  const originalsFolderId = await findOrCreateFolder('originals', eventFolderId);
  const thumbnailsFolderId = await findOrCreateFolder('thumbnails', eventFolderId);

  // Enable public read access so guests / slideshows can stream from Google CDN
  await makeFolderPublicView(eventFolderId);
  await makeFolderPublicView(originalsFolderId);
  await makeFolderPublicView(thumbnailsFolderId);

  return {
    rootFolderId,
    eventFolderId,
    originalsFolderId,
    thumbnailsFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${eventFolderId}`
  };
}

/**
 * Create a Google Drive Resumable Upload Session URI for guest direct upload
 */
export async function createResumableUploadSession({ folderId, fileName, mimeType = 'image/jpeg', fileSize }) {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const metadata = {
    name: fileName,
    parents: [folderId]
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType
  };

  if (fileSize) {
    headers['X-Upload-Content-Length'] = String(fileSize);
  }

  const res = await fetch(DRIVE_RESUMABLE_INIT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(metadata)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to initialize Google Drive upload session');
  }

  const uploadUri = res.headers.get('Location');
  if (!uploadUri) {
    throw new Error('Google Drive did not return a session upload URI');
  }

  return uploadUri;
}

/**
 * Upload a binary Blob directly to a Google Drive Resumable Session URI
 * (Can be called by guest phone directly without OAuth headers)
 */
export function uploadBlobToResumableSession(uploadUri, blob, mimeType = 'image/jpeg', onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUri, true);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress({ loaded: e.loaded, total: e.total, percent });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          resolve(result);
        } catch (err) {
          resolve({ id: xhr.responseText });
        }
      } else {
        reject(new Error(`Drive upload failed (status ${xhr.status}): ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Google Drive direct upload'));
    xhr.ontimeout = () => reject(new Error('Google Drive upload timed out'));

    xhr.send(blob);
  });
}

/**
 * Helper to get CDN direct image URLs from Google Drive File ID
 */
export function getDriveCDNUrl(fileId, size = 1600) {
  if (!fileId) return '';
  return `https://lh3.googleusercontent.com/d/${fileId}=s${size}`;
}

export function getDriveThumbnailUrl(fileId, size = 400) {
  if (!fileId) return '';
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

/**
 * Upload a Blob as a file into a Google Drive folder (Host Direct)
 */
export async function uploadBlobToDrive(folderId, fileName, blob, mimeType = 'image/jpeg') {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const metadata = {
    name: fileName,
    parents: [folderId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Failed to upload ${fileName} to Google Drive`);
  }

  return data;
}

/**
 * Sync an entire event's photos and database manifest to Google Drive
 */
export async function syncEventToGoogleDrive(slug, onProgress = () => {}) {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Google Drive is not connected');

  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  onProgress({ stage: 'init', message: 'Connecting to Google Drive...' });

  const { eventFolderId, originalsFolderId, thumbnailsFolderId } = await setupEventDriveHierarchy(slug, event.name);

  // Fetch photos to sync
  const photos = await db.photos.where('event_slug').equals(slug).toArray();
  const approvedPhotos = photos.filter(p => p.status === 'approved');

  let syncedCount = 0;
  const total = approvedPhotos.length + 1; // +1 for manifest

  for (let i = 0; i < approvedPhotos.length; i++) {
    const photo = approvedPhotos[i];
    onProgress({
      stage: 'uploading',
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 100),
      message: `Uploading photo ${i + 1} of ${approvedPhotos.length}...`
    });

    try {
      let driveOrigId = photo.drive_orig_id;
      let driveThumbId = photo.drive_thumb_id;

      if (!driveOrigId && photo.original_blob) {
        const up = await uploadBlobToDrive(originalsFolderId, photo.filename, photo.original_blob, photo.mime_type || 'image/jpeg');
        driveOrigId = up.id;
      }
      if (!driveThumbId && photo.thumb_blob) {
        const upThumb = await uploadBlobToDrive(thumbnailsFolderId, `thumb_${photo.filename}`, photo.thumb_blob, 'image/jpeg');
        driveThumbId = upThumb.id;
      }

      if (driveOrigId || driveThumbId) {
        await db.photos.update(photo.id, {
          drive_orig_id: driveOrigId,
          drive_thumb_id: driveThumbId,
          drive_orig_url: driveOrigId ? getDriveCDNUrl(driveOrigId, 2048) : photo.drive_orig_url,
          drive_thumb_url: driveThumbId ? getDriveThumbnailUrl(driveThumbId, 400) : photo.drive_thumb_url
        });
      }

      await db.sync_logs.add({
        event_slug: slug,
        photo_id: photo.id,
        status: 'synced',
        timestamp: new Date().toISOString()
      });
      syncedCount++;
    } catch (err) {
      console.error(`Failed to sync photo ${photo.id}:`, err);
      await db.sync_logs.add({
        event_slug: slug,
        photo_id: photo.id,
        status: 'error',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Upload event_manifest.json snapshot
  onProgress({
    stage: 'manifest',
    current: total,
    total,
    percent: 100,
    message: 'Uploading event_manifest.json backup...'
  });

  const guests = await db.guests.where('event_slug').equals(slug).toArray();
  const manifestData = {
    version: '2.0.0',
    synced_at: new Date().toISOString(),
    event,
    guests,
    photos_count: approvedPhotos.length,
    photos_metadata: approvedPhotos.map(p => ({
      id: p.id,
      filename: p.filename,
      hash: p.hash,
      guest_name: p.guest_name,
      width: p.width,
      height: p.height,
      size: p.size,
      status: p.status,
      drive_orig_id: p.drive_orig_id,
      drive_thumb_id: p.drive_thumb_id,
      drive_orig_url: p.drive_orig_url,
      drive_thumb_url: p.drive_thumb_url,
      created_at: p.created_at
    }))
  };

  const manifestBlob = new Blob([JSON.stringify(manifestData, null, 2)], { type: 'application/json' });
  await uploadBlobToDrive(eventFolderId, 'event_manifest.json', manifestBlob, 'application/json');

  return {
    success: true,
    synced_count: syncedCount,
    total_approved: approvedPhotos.length,
    folder_id: eventFolderId,
    folder_url: `https://drive.google.com/drive/folders/${eventFolderId}`
  };
}
