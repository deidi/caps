import { db } from './db.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

let tokenClient = null;

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
    google.accounts.oauth2.revoke(token, () => {});
  }
  setStoredDriveToken(null);
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

  // Search if folder already exists
  const query = `name = '${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
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

  return createData.id;
}

/**
 * Upload a Blob as a file into a Google Drive folder
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
 * Sync an event's photos and database manifest to Google Drive
 */
export async function syncEventToGoogleDrive(slug, onProgress = () => {}) {
  const token = getStoredDriveToken();
  if (!token) throw new Error('Google Drive is not connected');

  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  onProgress({ stage: 'init', message: 'Connecting to Google Drive...' });

  // 1. Ensure Root Folder: /Caps Events
  const rootFolderId = await findOrCreateFolder('Caps Events', 'root');

  // 2. Ensure Event Folder: /Caps Events/<Event Name>
  const eventFolderId = await findOrCreateFolder(event.name, rootFolderId);

  // 3. Ensure Subfolders: /originals and /thumbnails
  const originalsFolderId = await findOrCreateFolder('originals', eventFolderId);
  const thumbnailsFolderId = await findOrCreateFolder('thumbnails', eventFolderId);

  // 4. Fetch photos to sync
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
      if (photo.original_blob) {
        await uploadBlobToDrive(originalsFolderId, photo.filename, photo.original_blob, photo.mime_type || 'image/jpeg');
      }
      if (photo.thumb_blob) {
        await uploadBlobToDrive(thumbnailsFolderId, `thumb_${photo.filename}`, photo.thumb_blob, 'image/jpeg');
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

  // 5. Upload event_manifest.json snapshot
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
      created_at: p.created_at
    }))
  };

  const manifestBlob = new Blob([JSON.stringify(manifestData, null, 2)], { type: 'application/json' });
  await uploadBlobToDrive(eventFolderId, 'event_manifest.json', manifestBlob, 'application/json');

  return {
    success: true,
    synced_count: syncedCount,
    total_approved: approvedPhotos.length,
    folder_id: eventFolderId
  };
}
