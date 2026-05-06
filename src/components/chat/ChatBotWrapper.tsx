'use client';

/**
 * ChatBotWrapper — Corner chat bubble with avatar video.
 *
 * Collapsed: 80px AvatarVideo circle (bottom-right), freeze-frame that plays on hover.
 * Expanded: Full ChatBot window.
 * Hidden on /ai page (full workspace handles it).
 */

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AvatarVideo } from '@/components/ai/AvatarVideo';
import { AvatarStateProvider, useAvatarState } from '@/lib/ai/avatar-store';
import { ChatBot } from './ChatBot';

const DISMISS_KEY = 'isla-bubble-dismissed';
const OPEN_KEY = 'chatbot-open';

export function ChatBotWrapper() {
  return (
    <AvatarStateProvider>
      <ChatBotInner />
    </AvatarStateProvider>
  );
}

function ChatBotInner() {
  const pathname = usePathname();
  const { status, hovering, setHovering } = useAvatarState();

  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage/sessionStorage
  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem(DISMISS_KEY) === 'true') {
      setDismissed(true);
    }
    if (localStorage.getItem(OPEN_KEY) === 'true') {
      setIsOpen(true);
    }
  }, []);

  // Persist open state
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(OPEN_KEY, String(isOpen));
    }
  }, [isOpen, mounted]);

  // Hide on /ai page or before mount
  if (!mounted || pathname === '/ai') return null;

  // Expanded — show the ChatBot window
  if (isOpen) {
    return <ChatBot onClose={() => setIsOpen(false)} />;
  }

  // Dismissed — nothing shown
  if (dismissed) return null;

  // Collapsed — avatar video bubble
  return (
    <div className="fixed bottom-6 right-6 z-50 group">
      {/* Pulsing ring */}
      <div
        className="absolute inset-0 rounded-full bg-teal-400/30 animate-ping"
        style={{ animationDuration: '3s' }}
      />

      {/* Avatar video button */}
      <button
        onClick={() => setIsOpen(true)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-teal-400 shadow-lg shadow-teal-500/25 hover:scale-110 transition-transform cursor-pointer"
        aria-label="Ask Isabelle"
      >
        <AvatarVideo status={status} hovering={hovering} />
      </button>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
          sessionStorage.setItem(DISMISS_KEY, 'true');
        }}
        className="absolute -top-1 -right-1 w-5 h-5 bg-gray-600 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-700"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
