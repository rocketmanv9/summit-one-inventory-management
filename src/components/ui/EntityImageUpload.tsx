'use client';

import { useRef, useCallback, useState } from 'react';
import { Camera, X, Loader2, ImagePlus, Sparkles, Check, RotateCcw } from 'lucide-react';
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
   * that creates a product image from the name/description. The generated image
   * lands in a refine panel where it can be steered ("more like a coil, less
   * like a spool") before it's attached — not blindly re-rolled.
   */
  generateContext?: { name: string; description?: string };
}

// One generated candidate + the instruction that produced it (null = the first
// base generation). Kept in a short history so a good earlier take isn't lost.
interface Attempt {
  image: string; // data URL (PNG from the API)
  note: string | null;
}

const MAX_ATTEMPTS = 5;

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

  // Refinement state — a candidate image being steered before it's attached.
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(-1); // index into attempts
  const [adjust, setAdjust] = useState('');

  const current = currentIdx >= 0 ? attempts[currentIdx] : null;

  // Call the image endpoint. When `note` is set, steer the current candidate;
  // otherwise generate fresh from the name/description.
  const runGenerate = useCallback(
    async (note: string | null) => {
      if (!generateContext?.name?.trim() || generating) return;
      setGenerating(true);
      setGenError(null);
      try {
        const res = await fetch('/api/ai/item-image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: generateContext.name,
            description: generateContext.description || '',
            ...(note && current ? { previous_image: current.image, adjustment: note } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Generation failed' }));
          const msg =
            typeof err.error === 'string' ? err.error : err.error?.message || err.message || 'Generation failed';
          throw new Error(msg);
        }
        const { image_data } = await res.json();
        // Append the new take, cap history, and focus it. Prior takes stay in
        // the strip so nothing is lost.
        setAttempts((prev) => {
          const next = [...prev, { image: image_data, note }].slice(-MAX_ATTEMPTS);
          setCurrentIdx(next.length - 1);
          return next;
        });
        setAdjust('');
      } catch (err: any) {
        setGenError(err.message || 'Generation failed');
      } finally {
        setGenerating(false);
      }
    },
    [generateContext, generating, current],
  );

  // Attach the focused candidate to the entity (re-encode to JPEG first).
  const handleUseCandidate = useCallback(async () => {
    if (!current) return;
    setGenError(null);
    try {
      const jpegDataUrl = await resizeImage(dataUrlToFile(current.image, 'ai-image.png'));
      await upload(jpegDataUrl);
      // Clear the refine panel — the image now lives on the entity.
      setAttempts([]);
      setCurrentIdx(-1);
    } catch (err: any) {
      setGenError(err.message || 'Could not attach image');
    }
  }, [current, upload]);

  const handleDiscardCandidates = useCallback(() => {
    setAttempts([]);
    setCurrentIdx(-1);
    setAdjust('');
    setGenError(null);
  }, []);

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
    [upload],
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
    [remove],
  );

  if (!entityId) return null;

  const sizeClass = sizeClasses[size];
  const isLoading = loading || uploading || generating;
  // Offer generation while there's no attached image and nothing being refined.
  const showGenerate = !!generateContext?.name?.trim() && !imageUrl && attempts.length === 0;
  const inRefine = attempts.length > 0 && !imageUrl;

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
            <img src={imageUrl} alt="Entity photo" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Camera className="h-5 w-5 text-white" />
            </div>
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
        ) : inRefine ? (
          /* Refine panel — the candidate being steered before attach. */
          <div className={`${sizeClass} rounded-lg overflow-hidden border-2 border-purple-300 relative`}>
            {current && <img src={current.image} alt="AI candidate" className="w-full h-full object-cover" />}
            {generating && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
              </div>
            )}
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
                {size !== 'sm' && <span className="text-[10px] font-medium">Add Photo</span>}
              </>
            )}
          </button>
        )}
      </div>

      {showGenerate && (
        <button
          type="button"
          onClick={() => runGenerate(null)}
          disabled={isLoading}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50"
          title="Generate a product image with AI"
        >
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {generating ? 'Generating…' : 'Generate with AI'}
        </button>
      )}

      {/* Refine controls: adjust prompt, history strip, keep / try-again. */}
      {inRefine && (
        <div className="w-56 space-y-2">
          {/* History strip — click any earlier take to bring it back. */}
          {attempts.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {attempts.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIdx(i)}
                  title={a.note ? `Adjustment: ${a.note}` : 'First generation'}
                  className={`relative h-9 w-9 shrink-0 overflow-hidden rounded border-2 transition-colors ${
                    i === currentIdx ? 'border-purple-500' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={a.image} alt={`Attempt ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Adjust input */}
          <div className="flex gap-1.5">
            <input
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              placeholder="Describe what to change…"
              disabled={generating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && adjust.trim() && !generating) {
                  e.preventDefault();
                  runGenerate(adjust.trim());
                }
              }}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400"
            />
            <button
              type="button"
              onClick={() => runGenerate(adjust.trim())}
              disabled={!adjust.trim() || generating}
              title="Refine the image with this instruction"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-purple-600 px-2 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Adjust
            </button>
          </div>

          {/* Keep this one / start over */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleUseCandidate}
              disabled={!current || generating || uploading}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Use this photo
            </button>
            <button
              type="button"
              onClick={handleDiscardCandidates}
              disabled={generating || uploading}
              title="Discard these and start over"
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> Start over
            </button>
          </div>
        </div>
      )}

      {genError && <span className="text-[11px] text-red-600 max-w-[14rem]">{genError}</span>}
    </div>
  );
}
