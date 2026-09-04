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
  canvas.width = Math.max(1, Math.round(targetWidth));
  canvas.height = Math.max(1, Math.round(targetHeight));
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('Canvas 2D context not available');

  // Fill canvas with white background so transparent or unpainted areas never turn black
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // High quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgSource, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0) resolve(blob);
      else reject(new Error('Failed to generate image blob'));
    }, mimeType, quality);
  });
}

/**
 * Process a raw photo file client-side:
 * - Computes SHA-256 duplicate hash
 * - Decodes reliably via HTMLImageElement (with createImageBitmap fallback)
 * - Auto-corrects orientation and strips unwanted metadata
 * - Downscales to high-res (max 2048px) & generates fast 360px thumbnail
 */
export async function processPhotoClient(file, options = {}) {
  const maxDimension = options.maxDimension || 2048;
  const thumbDimension = options.thumbDimension || 360;
  const quality = options.quality || 0.85;
  const thumbQuality = options.thumbQuality || 0.70;

  // 1. Compute SHA-256 duplicate hash from raw input
  const hash = await computePhotoHash(file);

  let imageSource = null;
  let srcWidth = 0;
  let srcHeight = 0;
  let objectUrlToRevoke = null;

  // 2. Load via HTMLImageElement first (Native mobile browser decoder handles HEIC, EXIF, and camera files reliably)
  try {
    objectUrlToRevoke = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrlToRevoke;

    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Failed to decode image file'));
        });
      }
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to decode image file'));
      });
    }

    srcWidth = img.naturalWidth || img.width;
    srcHeight = img.naturalHeight || img.height;
    imageSource = img;
  } catch (imgErr) {
    console.warn('HTMLImageElement decode failed, trying createImageBitmap:', imgErr);
    if (typeof createImageBitmap === 'function') {
      try {
        imageSource = await createImageBitmap(file, { imageOrientation: 'from-image' });
        srcWidth = imageSource.width;
        srcHeight = imageSource.height;
      } catch (bitmapErr) {
        console.warn('createImageBitmap failed:', bitmapErr);
        imageSource = null;
      }
    }
  }

  // Graceful fallback if image decoding completely failed
  if (!imageSource || !srcWidth || !srcHeight) {
    return {
      hash,
      filename: file.name || `photo_${Date.now()}.jpg`,
      originalBlob: file,
      thumbBlob: file,
      width: 1920,
      height: 1080,
      size: file.size,
      mimeType: file.type || 'image/jpeg',
    };
  }

  // 3. Calculate high-res dimensions
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

  // 4. Calculate thumbnail dimensions
  let thumbWidth = srcWidth;
  let thumbHeight = srcHeight;
  if (srcWidth >= srcHeight) {
    thumbWidth = thumbDimension;
    thumbHeight = Math.round((srcHeight * thumbDimension) / srcWidth);
  } else {
    thumbHeight = thumbDimension;
    thumbWidth = Math.round((srcWidth * thumbDimension) / srcHeight);
  }

  // 5. Render High-Res Blob & Thumbnail Blob
  let originalBlob;
  let thumbBlob;

  try {
    originalBlob = await renderToBlob(imageSource, targetWidth, targetHeight, quality, 'image/jpeg');
    thumbBlob = await renderToBlob(imageSource, thumbWidth, thumbHeight, thumbQuality, 'image/jpeg');
  } catch (renderErr) {
    console.warn('Canvas rendering error, using raw file as original:', renderErr);
    originalBlob = file;
    thumbBlob = file;
  }

  // Clean up
  if (imageSource && typeof imageSource.close === 'function') {
    try { imageSource.close(); } catch (_) {}
  }
  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
  }

  return {
    hash,
    filename: file.name || `photo_${Date.now()}.jpg`,
    originalBlob,
    thumbBlob,
    width: targetWidth,
    height: targetHeight,
    size: originalBlob.size || file.size,
    mimeType: 'image/jpeg',
  };
}
