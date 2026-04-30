'use client';

/**
 * AvatarVideo — Video player for the Isabelle Martinez avatar.
 *
 * Three stacked <video> elements (idle.mp4, talking.mp4, thinking.mp4),
 * crossfaded via CSS opacity transitions. All videos stay loaded and looping
 * to avoid rebuffering flicker on state changes.
 *
 * Falls back to avatar.svg with a breathing animation if video files are missing.
 */

import { useState, useRef, useEffect } from 'react';
import type { AvatarStatus } from '@/lib/ai/avatar-store';

interface AvatarVideoProps {
  status: AvatarStatus;
}

export function AvatarVideo({ status }: AvatarVideoProps) {
  const [videoError, setVideoError] = useState(false);
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkingRef = useRef<HTMLVideoElement>(null);
  const thinkingRef = useRef<HTMLVideoElement>(null);

  // Attempt to play all videos on mount (must be muted for autoplay policy)
  useEffect(() => {
    idleRef.current?.play().catch(() => setVideoError(true));
    talkingRef.current?.play().catch(() => {});
    thinkingRef.current?.play().catch(() => {});
  }, []);

  if (videoError) {
    return (
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center">
        {/* Fallback avatar image with breathing animation */}
        <div
          className={`relative ${status === 'thinking' ? 'animate-pulse' : ''}`}
          style={{
            animation: status !== 'thinking' ? 'breathe 4s ease-in-out infinite' : undefined,
          }}
        >
          <img
            src="/avatar/avatar.svg"
            alt="Isabelle Martinez"
            className="w-40 h-40 rounded-full object-cover border-4 border-teal-400/50 shadow-lg shadow-teal-500/20"
          />
          {/* Status ring */}
          <div
            className={`absolute inset-0 rounded-full border-4 transition-colors duration-300 ${
              status === 'talking'
                ? 'border-teal-400 animate-ping'
                : status === 'thinking'
                  ? 'border-amber-400 animate-pulse'
                  : 'border-transparent'
            }`}
            style={{ animationDuration: status === 'talking' ? '1.5s' : undefined }}
          />
        </div>

        {/* Breathing keyframe */}
        <style>{`
          @keyframes breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.03); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {/* Idle video (base layer — confident nod) */}
      <video
        ref={idleRef}
        src="/avatar/idle.mp4"
        loop
        muted
        playsInline
        autoPlay
        onError={() => setVideoError(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          status === 'idle' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Talking video (approving nod + thumbs up) */}
      <video
        ref={talkingRef}
        src="/avatar/talking.mp4"
        loop
        muted
        playsInline
        autoPlay
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          status === 'talking' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Thinking video (concerned, checking inventory) */}
      <video
        ref={thinkingRef}
        src="/avatar/thinking.mp4"
        loop
        muted
        playsInline
        autoPlay
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          status === 'thinking' ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
