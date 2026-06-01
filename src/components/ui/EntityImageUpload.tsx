'use client';

import { useRef, useCallback, useState } from 'react';
import { Camera, X, Loader2, ImagePlus, Sparkles } from 'lucide-react';
import { resizeImage, validateImageFile, dataUrlToFile } from '@/lib/image-utils';
import { useEntityImage } from '@/hooks/useEntityImage';

type EntityType = 'catalog_item' | 'asset' | 'tool' | 'vehicle' | 'equipment';

interface EntityImageUploadProps {
  entityType: EntityType;
  entityId: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * When provided, shows a "Generate with AI" button (while no image exists)
   * that creates a product image from the name/description and attaches it.
   */
  generateContext?: { name: string; description?: string };
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
  generateContext,
}: EntityImageUploadProps) {
  const { imageUrl, loading, uploading, upload, remove } = useEntityImage(entityType, entityId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!generateContext?.name?.trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/ai/item-image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: generateContext.name, description: generateContext.description || '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        // err.error is a string from this route's own returns, but an object
        // ({ message, code }) when it comes through the chassis error envelope
        // (e.g. timeouts). Pull the message out of either shape so we don't
        // surface "[object Object]".
        const msg =
          typeof err.error === 'string'
            ? err.error
            : err.error?.message || err.message || 'Generation failed';
        throw new Error(msg);
      }
      const { image_data } = await res.json();
      // Re-encode the generated PNG to a resized JPEG, then attach via the hook.
      const jpegDataUrl = await resizeImage(dataUrlToFile(image_data, 'ai-image.png'));
      await upload(jpegDataUrl);
    } catch (err: any) {
      setGenError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [generateContext, generating, upload]);

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
  const isLoading = loading || uploading || generating;
  const showGenerate = !!generateContext?.name?.trim() && !imageUrl;

  return (
    <div className={`inline-flex flex-col items-start gap-1.5 ${className}`}>
    <div className="relative inline-block">
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

    {showGenerate && (
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isLoading}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50"
        title="Generate a product image with AI"
      >
        {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        {generating ? 'Generating…' : 'Generate with AI'}
      </button>
    )}
    {genError && <span className="text-[11px] text-red-600 max-w-[10rem]">{genError}</span>}
    </div>
  );
}
