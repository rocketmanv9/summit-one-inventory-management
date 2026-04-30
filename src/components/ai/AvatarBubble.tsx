'use client';

/**
 * AvatarBubble — Small avatar circle in the bottom-right corner.
 *
 * Navigates to /ai on click. Hidden when already on /ai.
 * Dismissible per session via sessionStorage.
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const DISMISS_KEY = 'isla-bubble-dismissed';

export function AvatarBubble() {
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem(DISMISS_KEY) === 'true') {
      setDismissed(true);
    }
  }, []);

  if (!mounted || dismissed || pathname === '/ai') return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 group">
      {/* Pulsing ring */}
      <div className="absolute inset-0 rounded-full bg-teal-400/30 animate-ping" style={{ animationDuration: '3s' }} />

      {/* Avatar button */}
      <button
        onClick={() => router.push('/ai')}
        className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-teal-400 shadow-lg shadow-teal-500/25 hover:scale-110 transition-transform cursor-pointer"
        aria-label="Ask Isabelle"
        title="Ask Isabelle"
      >
        <img
          src="/avatar/avatar.svg"
          alt="Isabelle Martinez"
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to a colored circle with initials if image missing
            const target = e.currentTarget;
            target.style.display = 'none';
            target.parentElement!.classList.add('bg-teal-600', 'flex', 'items-center', 'justify-center');
            const span = document.createElement('span');
            span.className = 'text-white font-bold text-lg';
            span.textContent = 'IM';
            target.parentElement!.appendChild(span);
          }}
        />
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

      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Ask Isabelle
        <div className="absolute top-full right-6 w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
      </div>
    </div>
  );
}
