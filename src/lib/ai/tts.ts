'use client';

/**
 * useTts — Client-side TTS hook
 *
 * Fetches audio from /api/ai/tts, plays it, and fires lifecycle callbacks.
 * Falls back to browser SpeechSynthesis if fetch fails.
 * Cleans up blob URLs on unmount.
 */

import { useRef, useCallback, useEffect, useState } from 'react';

interface UseTtsOptions {
  onStart?: () => void;
  onEnd?: () => void;
  muted?: boolean;
}

export function useTts({ onStart, onEnd, muted }: UseTtsOptions = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    // Abort in-flight fetch
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current = null;
    }

    // Revoke old blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    // Cancel browser speech synthesis fallback
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
  }, []);

  const fallbackToBrowserSpeech = useCallback(
    (text: string) => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
          setIsSpeaking(true);
          onStart?.();
        };

        utterance.onend = () => {
          setIsSpeaking(false);
          onEnd?.();
        };

        utterance.onerror = () => {
          setIsSpeaking(false);
          onEnd?.();
        };

        window.speechSynthesis.speak(utterance);
      } else {
        onEnd?.();
      }
    },
    [onStart, onEnd]
  );

  const speak = useCallback(
    async (text: string) => {
      // Stop any previous playback
      stop();

      if (muted || !text.trim()) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/ai/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!res.ok) {
          console.warn('[TTS] API returned non-OK status, falling back to browser speech');
          fallbackToBrowserSpeech(text);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        // Clean up previous blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.addEventListener('play', () => {
          setIsSpeaking(true);
          onStart?.();
        });

        audio.addEventListener('ended', () => {
          setIsSpeaking(false);
          onEnd?.();
        });

        audio.addEventListener('error', () => {
          setIsSpeaking(false);
          onEnd?.();
        });

        await audio.play();
      } catch (err: any) {
        if (err.name === 'AbortError') return;

        console.warn('[TTS] Fetch failed, falling back to browser speech:', err.message);
        fallbackToBrowserSpeech(text);
      }
    },
    [muted, onStart, onEnd, stop, fallbackToBrowserSpeech]
  );

  return { speak, stop, isSpeaking };
}
