import sharp from 'sharp';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

/**
 * Compute SHA-256 hash of a buffer
 */
export function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Process and save original and thumbnail images
 */
export async function processAndSavePhoto({
  buffer,
  originalFilename,
  eventSlug,
  dataRootDir,
  stripExif = false
}) {
  const hash = computeFileHash(buffer);
  const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
  const uniqueName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;

  // Ensure directories exist
  const originalsDir = path.join(dataRootDir, 'events', eventSlug, 'originals');
  const thumbnailsDir = path.join(dataRootDir, 'events', eventSlug, 'thumbnails');
  const deletedDir = path.join(dataRootDir, 'events', eventSlug, 'deleted');

  if (!fs.existsSync(originalsDir)) fs.mkdirSync(originalsDir, { recursive: true });
  if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });
  if (!fs.existsSync(deletedDir)) fs.mkdirSync(deletedDir, { recursive: true });

  const originalPath = path.join(originalsDir, uniqueName);
  const thumbnailPath = path.join(thumbnailsDir, uniqueName);

  // 1. Process and save original
  if (stripExif) {
    // Re-encode via sharp to strip all EXIF metadata while rotating to correct orientation
    await sharp(buffer)
      .rotate() // auto-orient based on EXIF before stripping
      .withMetadata({ exif: {} }) // strip metadata
      .toFile(originalPath);
  } else {
    // Write original buffer directly to preserve full EXIF metadata
    await fs.promises.writeFile(originalPath, buffer);
  }

  // 2. Generate 300px thumbnail with auto-orientation
  await sharp(buffer)
    .rotate()
    .resize({ width: 300, withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toFile(thumbnailPath);

  return {
    filename: uniqueName,
    hash,
    originalRelativePath: `/data/events/${eventSlug}/originals/${uniqueName}`,
    thumbnailRelativePath: `/data/events/${eventSlug}/thumbnails/${uniqueName}`
  };
}
