/**
 * Shared image utilities for entity photo uploads.
 * Used by EntityImageUpload component and ImageAttachment component.
 */

export const MAX_RAW_SIZE = 16 * 1024 * 1024; // 16MB raw file limit
export const MAX_DIMENSION = 1024;
export const JPEG_QUALITY = 0.85;

/**
 * Validate that a file is an image and within size limits.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return 'File must be an image';
  }
  if (file.size > MAX_RAW_SIZE) {
    return `File too large (max ${MAX_RAW_SIZE / 1024 / 1024}MB)`;
  }
  return null;
}

/**
 * Resize an image to fit within MAX_DIMENSION on its longest side,
 * compress to JPEG, and return as a base64 data URL.
 */
export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}
