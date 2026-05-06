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

const VARIANT_STYLES: Record<AvatarVariant, { container: string; fallback: string; objectPosition: string }> = {
  bubble: {
    container: 'w-14 h-14 rounded-full',
    fallback: 'w-14 h-14 rounded-full',
    objectPosition: 'center 15%',
  },
  workspace: {
    container: 'w-28 h-20 rounded-xl',
    fallback: 'w-28 h-20 rounded-xl',
    objectPosition: 'center 15%',
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
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
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
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
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
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          status === 'thinking' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectPosition: styles.objectPosition }}
      />
    </div>
  );
}
