/**
 * Getting a photo in: the camera, the gallery or a sample. Photos stay in memory only: they
 * are never uploaded and never written to storage.
 */

export const MAX_PHOTO_SIDE = 2048;

export interface Photo {
  id: string;
  name: string;
  /** Upright (EXIF orientation applied), at most MAX_PHOTO_SIDE on the long side. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

let count = 0;

/** Decodes an image the right way up. */
async function decodeUpright(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; close?: () => void }> {
  try {
    // Current browsers rotate by the EXIF orientation with 'from-image'.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older browsers: an <img> follows the EXIF orientation by default.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Decodes, turns upright and scales a photo down to at most 2048 px on its long side. */
export async function loadPhoto(blob: Blob, name: string): Promise<Photo> {
  const decoded = await decodeUpright(blob);
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
  decoded.close?.();
  count += 1;
  return { id: `photo-${count}`, name, canvas, width: canvas.width, height: canvas.height };
}

export async function loadPhotoFromUrl(url: string, name: string): Promise<Photo> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${name} (${response.status})`);
  return loadPhoto(await response.blob(), name);
}

/**
 * Asks for a photo: with `camera`, phones open the rear camera (capture="environment");
 * otherwise the gallery or file picker. Resolves null if the user backs out.
 */
export function pickPhotoFile(camera: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.append(input);
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    input.click();
  });
}
