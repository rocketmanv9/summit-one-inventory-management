'use client';

/**
 * AvatarVideo — 80px circular video avatar for Isabelle Martinez.
 *
 * Three stacked <video> elements (idle.mp4, talking.mp4, thinking.mp4),
 * crossfaded via CSS opacity. Videos only play when hovered or AI is active.
 * Face is cropped via object-fit/object-position to zoom into the face area.
 *
 * Falls back to avatar.svg if video files are missing.
 */

import { useState, useRef, useEffect } from 'react';
import type { AvatarStatus } from '@/lib/ai/avatar-store';

type AvatarVariant = 'bubble' | 'workspace';

interface AvatarVideoProps {
  status: AvatarStatus;
  hovering: boolean;
  /** 'bubble' = small circle (corner chat), 'workspace' = large rectangle (/ai page) */
  variant?: AvatarVariant;
}

const VARIANT_STYLES: Record<AvatarVariant, { container: string; fallback: string; objectPosition: string; scale: string }> = {
  bubble: {
    container: 'w-24 h-24 rounded-full',
    fallback: 'w-24 h-24 rounded-full',
    objectPosition: 'center 10%',
    scale: 'scale-[1.4]',
  },
  workspace: {
    container: 'w-full h-full rounded-2xl',
    fallback: 'w-full h-full rounded-2xl',
    objectPosition: 'center 10%',
    scale: 'scale-[1.3]',
  },
};

export function AvatarVideo({ status, hovering, variant = 'bubble' }: AvatarVideoProps) {
  const [videoError, setVideoError] = useState(false);
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkingRef = useRef<HTMLVideoElement>(null);
  const thinkingRef = useRef<HTMLVideoElement>(null);

  const shouldPlay = hovering || status !== 'idle';

  // Play or pause all videos based on hover / active state
  useEffect(() => {
    const refs = [idleRef, talkingRef, thinkingRef];
    refs.forEach((ref) => {
      const el = ref.current;
      if (!el) return;
      if (shouldPlay) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
  }, [shouldPlay]);

  const styles = VARIANT_STYLES[variant];

  if (videoError) {
    return (
      <div className={`${styles.fallback} overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center flex-shrink-0`}>
        <img
          src="/avatar/avatar.svg"
          alt="Isabelle Martinez"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={`relative ${styles.container} overflow-hidden bg-black flex-shrink-0`}>
      {/* Idle video (base layer — confident nod) */}
      <video
        ref={idleRef}
        src="/avatar/idle.mp4"
        loop
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate"
        onError={() => setVideoError(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${styles.scale} ${
          status === 'idle' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectPosition: styles.objectPosition }}
      />

      {/* Talking video (approving nod + thumbs up) */}
      <video
        ref={talkingRef}
        src="/avatar/talking.mp4"
        loop
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${styles.scale} ${
          status === 'talking' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectPosition: styles.objectPosition }}
      />

      {/* Thinking video (concerned, checking inventory) */}
      <video
        ref={thinkingRef}
        src="/avatar/thinking.mp4"
        loop
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${styles.scale} ${
          status === 'thinking' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectPosition: styles.objectPosition }}
      />
    </div>
  );
}
