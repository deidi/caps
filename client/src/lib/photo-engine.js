import exifr from 'exifr';

/**
 * Compute SHA-256 hash from an ArrayBuffer or Blob
 */
export async function computePhotoHash(blobOrBuffer) {
  let buffer;
  if (blobOrBuffer instanceof ArrayBuffer) {
    buffer = blobOrBuffer;
  } else if (blobOrBuffer instanceof Blob) {
    buffer = await blobOrBuffer.arrayBuffer();
  } else {
    throw new Error('Unsupported input type for hashing');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper to render an image source into a resized Blob via Canvas
 */
async function renderToBlob(imgSource, targetWidth, targetHeight, quality = 0.85, mimeType = 'image/jpeg') {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (!ctx) throw new Error('Canvas 2D context not available');

  // High quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgSource, 0, 0, targetWidth, targetHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image blob'));
    }, mimeType, quality);
  });
}

/**
 * Process a raw photo file client-side:
 * - Computes SHA-256 duplicate hash
 * - Auto-corrects EXIF orientation and strips metadata
 * - Downscales to high-res (max 2048px)
 * - Generates fast 360px thumbnail
 */
export async function processPhotoClient(file, options = {}) {
  const maxDimension = options.maxDimension || 1600;
  const thumbDimension = options.thumbDimension || 360;
  const quality = options.quality || 0.80;
  const thumbQuality = options.thumbQuality || 0.65;

  // 1. Compute SHA-256 duplicate hash from raw input
  const hash = await computePhotoHash(file);

  // 2. Parse orientation with exifr (fallback to 1 if missing)
  let orientation = 1;
  try {
    orientation = await exifr.orientation(file) || 1;
  } catch (err) {
    console.warn('EXIF orientation read skipped:', err);
  }

  // 3. Load image into an HTMLImageElement or ImageBitmap
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Failed to decode image file'));
    img.src = objectUrl;
  });

  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  // 4. Calculate high-res dimensions
  let targetWidth = srcWidth;
  let targetHeight = srcHeight;

  if (srcWidth > maxDimension || srcHeight > maxDimension) {
    if (srcWidth >= srcHeight) {
      targetWidth = maxDimension;
      targetHeight = Math.round((srcHeight * maxDimension) / srcWidth);
    } else {
      targetHeight = maxDimension;
      targetWidth = Math.round((srcWidth * maxDimension) / srcHeight);
    }
  }

  // 5. Calculate thumbnail dimensions
  let thumbWidth = srcWidth;
  let thumbHeight = srcHeight;
  if (srcWidth >= srcHeight) {
    thumbWidth = thumbDimension;
    thumbHeight = Math.round((srcHeight * thumbDimension) / srcWidth);
  } else {
    thumbHeight = thumbDimension;
    thumbWidth = Math.round((srcWidth * thumbDimension) / srcHeight);
  }

  // 6. Render High-Res Blob & Thumbnail Blob (Canvas drawing automatically strips EXIF)
  const originalBlob = await renderToBlob(img, targetWidth, targetHeight, quality, 'image/jpeg');
  const thumbBlob = await renderToBlob(img, thumbWidth, thumbHeight, thumbQuality, 'image/jpeg');

  // Clean up source URL
  URL.revokeObjectURL(objectUrl);

  return {
    hash,
    filename: file.name || `photo_${Date.now()}.jpg`,
    originalBlob,
    thumbBlob,
    width: targetWidth,
    height: targetHeight,
    size: originalBlob.size,
    mimeType: 'image/jpeg'
  };
}
