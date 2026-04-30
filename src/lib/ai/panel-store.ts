'use client';

/**
 * AI Panel State
 *
 * Simple React context + localStorage for panel open/close state.
 * No external dependencies (no zustand).
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import React from 'react';

interface AiPanelState {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const AiPanelContext = createContext<AiPanelState>({
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
});

const STORAGE_KEY = 'ai-panel-open';

export function AiPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Restore from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setIsOpen(true);
    setMounted(true);
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(STORAGE_KEY, String(isOpen));
    }
  }, [isOpen, mounted]);

  // Keyboard shortcut: Cmd+J / Ctrl+J
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return React.createElement(
    AiPanelContext.Provider,
    { value: { isOpen, toggle, open, close } },
    children
  );
}

export function useAiPanel() {
  return useContext(AiPanelContext);
}
