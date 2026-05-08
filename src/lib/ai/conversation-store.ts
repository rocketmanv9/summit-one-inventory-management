'use client';

/**
 * AI Conversation Store
 *
 * React context + localStorage for tracking the current conversation ID
 * per surface (corner, panel, workspace). Follows panel-store.ts pattern.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import React from 'react';

interface ConversationState {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  clearConversation: () => void;
}

const ConversationContext = createContext<ConversationState>({
  conversationId: null,
  setConversationId: () => {},
  clearConversation: () => {},
});

function storageKey(surface: string) {
  return `ai-conversation-${surface}`;
}

export function ConversationProvider({
  surface = 'corner',
  children,
}: {
  surface?: 'corner' | 'panel' | 'workspace';
  children: ReactNode;
}) {
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Restore from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey(surface));
    if (stored) setConversationIdState(stored);
    setMounted(true);
  }, [surface]);

  // Persist to localStorage
  useEffect(() => {
    if (!mounted) return;
    const key = storageKey(surface);
    if (conversationId) {
      localStorage.setItem(key, conversationId);
    } else {
      localStorage.removeItem(key);
    }
  }, [conversationId, mounted, surface]);

  const setConversationId = useCallback((id: string | null) => {
    setConversationIdState(id);
  }, []);

  const clearConversation = useCallback(() => {
    setConversationIdState(null);
  }, []);

  return React.createElement(
    ConversationContext.Provider,
    { value: { conversationId, setConversationId, clearConversation } },
    children
  );
}

export function useConversation() {
  return useContext(ConversationContext);
}
