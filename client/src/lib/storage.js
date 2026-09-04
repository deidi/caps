import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = (
  import.meta.env?.VITE_SUPABASE_URL ||
  'https://zraiiydadpagbxqqezkm.supabase.co'
).trim();

const DEFAULT_SUPABASE_ANON_KEY = (
  import.meta.env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyYWlpeWRhZHBhZ2J4cXFlemttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDMwNjIsImV4cCI6MjEwNDExOTA2Mn0.QOOParHXXuqSnXmePel6rDyPCt9RLjdxskby-8yBvCg'
).trim();

const DEFAULT_BUCKET = (
  import.meta.env?.VITE_SUPABASE_BUCKET ||
  'eventcaps-photos'
).trim();

let cachedClient = null;

export function getSupabaseConfig() {
  const url = localStorage.getItem('caps_supabase_url') || DEFAULT_SUPABASE_URL;
  const anonKey = localStorage.getItem('caps_supabase_anon_key') || DEFAULT_SUPABASE_ANON_KEY;
  const bucket = localStorage.getItem('caps_supabase_bucket') || DEFAULT_BUCKET;
  return { url: url.trim(), anonKey: anonKey.trim(), bucket: bucket.trim() };
}

export function setSupabaseConfig(url, anonKey, bucket = DEFAULT_BUCKET) {
  if (url) localStorage.setItem('caps_supabase_url', url.trim());
  else localStorage.removeItem('caps_supabase_url');

  if (anonKey) localStorage.setItem('caps_supabase_anon_key', anonKey.trim());
  else localStorage.removeItem('caps_supabase_anon_key');

  if (bucket) localStorage.setItem('caps_supabase_bucket', bucket.trim());
  else localStorage.removeItem('caps_supabase_bucket');

  cachedClient = null;
}

export function isStorageConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase Storage is not configured. Please set your Project URL and Anon Key in Settings.');
  }
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

/**
 * Test connectivity to Supabase and the eventcaps-photos bucket
 */
export async function testStorageConnection() {
  const client = getSupabaseClient();
  const { bucket } = getSupabaseConfig();

  // Attempt to list files from bucket root (or verify bucket exists)
  const { data, error } = await client.storage.from(bucket).list('', {
    limit: 1,
    offset: 0,
  });

  if (error) {
    throw new Error(`Supabase Storage Error: ${error.message}. Make sure bucket '${bucket}' exists and is Public.`);
  }

  return { success: true, bucket, message: `Connected to Supabase bucket: ${bucket}` };
}

/**
 * Upload an original photo + thumbnail directly from phone to Supabase Storage
 */
export async function uploadPhotoToStorage({
  eventSlug,
  fileName,
  origBlob,
  thumbBlob,
  mimeType = 'image/jpeg',
}) {
  const client = getSupabaseClient();
  const { bucket } = getSupabaseConfig();

  const safeSlug = (eventSlug || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeName = (fileName || `photo_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);

  const origPath = `${safeSlug}/orig_${timestamp}_${rand}_${safeName}`;
  const thumbPath = `${safeSlug}/thumb_${timestamp}_${rand}_${safeName}`;

  // 1. Upload original photo
  const { error: origError } = await client.storage.from(bucket).upload(origPath, origBlob, {
    contentType: mimeType,
    upsert: true,
  });

  if (origError) {
    throw new Error(`Original photo upload failed: ${origError.message}`);
  }

  // 2. Upload micro-thumbnail
  const { error: thumbError } = await client.storage.from(bucket).upload(thumbPath, thumbBlob, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  if (thumbError) {
    console.warn(`Thumbnail upload warning: ${thumbError.message}`);
  }

  // 3. Get Public CDN URLs
  const { data: origUrlData } = client.storage.from(bucket).getPublicUrl(origPath);
  const { data: thumbUrlData } = client.storage.from(bucket).getPublicUrl(thumbPath);

  const origUrl = origUrlData?.publicUrl || '';
  const thumbUrl = thumbUrlData?.publicUrl || origUrl;

  return {
    origPath,
    thumbPath,
    origUrl,
    thumbUrl,
    bucket,
  };
}

/**
 * Delete a photo from Supabase Storage
 */
export async function deletePhotoFromStorage(paths = []) {
  if (!paths || !paths.length) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const validPaths = paths.filter(Boolean);
    if (validPaths.length > 0) {
      await client.storage.from(bucket).remove(validPaths);
    }
  } catch (err) {
    console.warn('Failed to delete photo from Supabase:', err);
  }
}
