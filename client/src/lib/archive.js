import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db } from './db.js';

/**
 * Export full event archive (.zip) containing:
 * - /originals/<filename>
 * - /thumbnails/thumb_<filename>
 * - metadata.json
 */
export async function exportFullEventArchive(slug, onProgress = () => {}) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const photos = await db.photos.where('event_slug').equals(slug).toArray();
  const guests = await db.guests.where('event_slug').equals(slug).toArray();

  const zip = new JSZip();
  const originalsFolder = zip.folder('originals');
  const thumbsFolder = zip.folder('thumbnails');

  // 1. Pack original and thumbnail Blobs
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    onProgress({
      stage: 'packing',
      current: i + 1,
      total: photos.length,
      percent: Math.round(((i + 1) / photos.length) * 50),
      message: `Packing photo ${i + 1} of ${photos.length}...`
    });

    if (photo.original_blob) {
      originalsFolder.file(photo.filename, photo.original_blob);
    }
    if (photo.thumb_blob) {
      thumbsFolder.file(`thumb_${photo.filename}`, photo.thumb_blob);
    }
  }

  // 2. Pack metadata.json
  const metadata = {
    exported_at: new Date().toISOString(),
    generator: 'Caps v2 Server-less Event Photo Hub',
    event,
    guests,
    total_photos: photos.length,
    photos: photos.map(p => ({
      id: p.id,
      filename: p.filename,
      hash: p.hash,
      status: p.status,
      guest_name: p.guest_name,
      width: p.width,
      height: p.height,
      size: p.size,
      created_at: p.created_at
    }))
  };

  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  // 3. Generate ZIP binary with progress tracking
  onProgress({
    stage: 'compressing',
    percent: 75,
    message: 'Compressing archive...'
  });

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    },
    (metadata) => {
      onProgress({
        stage: 'compressing',
        percent: 50 + Math.round(metadata.percent * 0.5),
        message: `Compressing archive (${Math.round(metadata.percent)}%)...`
      });
    }
  );

  // 4. Trigger browser download
  const archiveFilename = `caps-${slug}-archive.zip`;
  saveAs(zipBlob, archiveFilename);

  return { success: true, filename: archiveFilename, size: zipBlob.size };
}

/**
 * Export selected photos as a .zip
 */
export async function exportSelectedPhotosZip(slug, photoIds, onProgress = () => {}) {
  if (!photoIds || !photoIds.length) {
    throw new Error('No photos selected for download');
  }

  const idSet = new Set(photoIds.map(id => parseInt(id, 10)));
  const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const selectedPhotos = allPhotos.filter(p => idSet.has(p.id));

  const zip = new JSZip();

  for (let i = 0; i < selectedPhotos.length; i++) {
    const photo = selectedPhotos[i];
    if (photo.original_blob) {
      zip.file(photo.filename, photo.original_blob);
    }
  }

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    },
    (metadata) => {
      onProgress({
        stage: 'compressing',
        percent: Math.round(metadata.percent),
        message: `Compressing selected photos (${Math.round(metadata.percent)}%)...`
      });
    }
  );

  const filename = `caps-${slug}-selected.zip`;
  saveAs(zipBlob, filename);

  return { success: true, filename, size: zipBlob.size };
}
