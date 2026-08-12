'use client';

import { Package } from 'lucide-react';

interface EntityImageThumbnailProps {
  url: string | undefined;
  alt?: string;
  size?: 'sm' | 'md';
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
};

/**
 * Read-only thumbnail for list/table rows.
 * Shows a placeholder icon when no image URL is provided.
 */
export function EntityImageThumbnail({
  url,
  alt = 'Photo',
  size = 'sm',
}: EntityImageThumbnailProps) {
  const sizeClass = sizeClasses[size];

  if (!url) {
    return (
      <div className={`${sizeClass} rounded border border-muted flex items-center justify-center bg-muted/30 shrink-0`}>
        <Package className="h-4 w-4 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={`${sizeClass} rounded border border-border object-cover shrink-0`}
    />
  );
}
