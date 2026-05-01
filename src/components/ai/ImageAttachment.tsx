'use client';

import { useRef, useCallback } from 'react';
import { ImagePlus, X } from 'lucide-react';

interface ImageAttachmentProps {
  pendingImage: string | null;
  onImageAttach: (dataUrl: string) => void;
  onImageRemove: () => void;
  disabled?: boolean;
}

const MAX_RAW_SIZE = 16 * 1024 * 1024; // 16MB raw file limit
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Resize an image to fit within MAX_DIMENSION on its longest side,
 * compress to JPEG, and return as a base64 data URL.
 */
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Scale down if needed
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

export function ImageAttachment({
  pendingImage,
  onImageAttach,
  onImageRemove,
  disabled,
}: ImageAttachmentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be re-selected
      e.target.value = '';

      // Validate type
      if (!file.type.startsWith('image/')) {
        return;
      }

      // Validate size
      if (file.size > MAX_RAW_SIZE) {
        return;
      }

      try {
        const dataUrl = await resizeImage(file);
        onImageAttach(dataUrl);
      } catch {
        // Silently fail — user can try again
      }
    },
    [onImageAttach]
  );

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Camera/image button */}
      {!pendingImage && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Attach image"
          title="Attach image"
        >
          <ImagePlus className="w-5 h-5" />
        </button>
      )}

      {/* Preview thumbnail */}
      {pendingImage && (
        <div className="relative inline-block flex-shrink-0">
          <img
            src={pendingImage}
            alt="Attached"
            className="w-10 h-10 rounded object-cover border border-gray-300"
          />
          <button
            type="button"
            onClick={onImageRemove}
            disabled={disabled}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
            aria-label="Remove image"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </>
  );
}
