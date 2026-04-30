'use client';

/**
 * Avatar State Context
 *
 * Manages video avatar status (idle/talking/thinking) and TTS mute preference.
 * Same pattern as panel-store.ts — React context + localStorage, no external deps.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import React from 'react';

export type AvatarStatus = 'idle' | 'talking' | 'thinking';

interface AvatarState {
  status: AvatarStatus;
  ttsMuted: boolean;
  hovering: boolean;
  setStatus: (status: AvatarStatus) => void;
  toggleMute: () => void;
  setHovering: (v: boolean) => void;
}

const AvatarStateContext = createContext<AvatarState>({
  status: 'idle',
  ttsMuted: false,
  hovering: false,
  setStatus: () => {},
  toggleMute: () => {},
  setHovering: () => {},
});

const MUTE_STORAGE_KEY = 'isla-tts-muted';

export function AvatarStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AvatarStatus>('idle');
  const [ttsMuted, setTtsMuted] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Restore mute preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(MUTE_STORAGE_KEY);
    if (stored === 'true') setTtsMuted(true);
  }, []);

  // Persist mute preference
  const toggleMute = useCallback(() => {
    setTtsMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return React.createElement(
    AvatarStateContext.Provider,
    { value: { status, ttsMuted, hovering, setStatus, toggleMute, setHovering } },
    children
  );
}

export function useAvatarState() {
  return useContext(AvatarStateContext);
}
