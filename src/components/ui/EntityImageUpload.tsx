'use client';

import { useRef, useCallback } from 'react';
import { Camera, X, Loader2, ImagePlus } from 'lucide-react';
import { resizeImage, validateImageFile } from '@/lib/image-utils';
import { useEntityImage } from '@/hooks/useEntityImage';

type EntityType = 'catalog_item' | 'asset' | 'tool' | 'vehicle' | 'equipment';

interface EntityImageUploadProps {
  entityType: EntityType;
  entityId: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-12 h-12',
  md: 'w-24 h-24',
  lg: 'w-40 h-40',
};

export function EntityImageUpload({
  entityType,
  entityId,
  size = 'md',
  className = '',
}: EntityImageUploadProps) {
  const { imageUrl, loading, uploading, upload, remove } = useEntityImage(entityType, entityId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const validationError = validateImageFile(file);
      if (validationError) return;

      try {
        const dataUrl = await resizeImage(file);
        await upload(dataUrl);
      } catch {
        // Error state is managed by the hook
      }
    },
    [upload]
  );

  const handleRemove = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await remove();
      } catch {
        // Error state is managed by the hook
      }
    },
    [remove]
  );

  if (!entityId) return null;

  const sizeClass = sizeClasses[size];
  const isLoading = loading || uploading;

  return (
    <div className={`relative inline-block ${className}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {imageUrl ? (
        /* Image exists — show it with hover overlay */
        <div
          className={`${sizeClass} rounded-lg overflow-hidden border border-border group relative cursor-pointer`}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          aria-label="Replace photo"
        >
          <img
            src={imageUrl}
            alt="Entity photo"
            className="w-full h-full object-cover"
          />
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Camera className="h-5 w-5 text-white" />
          </div>
          {/* Remove button */}
          <button
            type="button"
            onClick={handleRemove}
            disabled={isLoading}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100 z-10"
            aria-label="Remove photo"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        /* No image — show upload button */
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className={`${sizeClass} rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary disabled:opacity-50`}
          aria-label="Upload photo"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <ImagePlus className={size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'} />
              {size !== 'sm' && (
                <span className="text-[10px] font-medium">Add Photo</span>
              )}
            </>
          )}
        </button>
      )}
    </div>
  );
}
