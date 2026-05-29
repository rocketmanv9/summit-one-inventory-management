import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Mobile Count - Summit One',
  description: 'Mobile cycle count interface',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Summit Count',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

// Embedded CSS for things that can't be done with inline styles:
// - Keyframe animations
// - Pseudo-class styles (focus, active, placeholder)
// - Scrollbar hiding
const embeddedCSS = `
@keyframes m-spin {
  to { transform: rotate(360deg); }
}

/* ── Global resets ── */
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

/* Reset buttons — removes ALL default browser chrome */
button, input[type="submit"] {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  margin: 0;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* Reset inputs */
input, textarea {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  font-family: inherit;
  font-size: 16px; /* prevents iOS zoom on focus */
  line-height: inherit;
  color: #111827;
  margin: 0;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
input::placeholder { color: #9ca3af; }
input:focus { outline: none; }

/* Number input — hide spinners everywhere */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] { -moz-appearance: textfield; }

/* Search input — hide clear button on iOS/webkit */
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
  -webkit-appearance: none;
}

/* ── Interactive states ── */
/* No transform on :active — mobile Safari cancels click events when the
   touch target moves between touchstart and touchend. Opacity-only feedback. */
.m-btn:active:not(:disabled) {
  opacity: 0.85;
}
.m-btn-save:active:not(:disabled) {
  opacity: 0.8;
}
.m-btn-submit:active:not(:disabled) {
  opacity: 0.85;
}
.m-asset-btn:active:not(:disabled) {
  opacity: 0.88;
}
.m-input-qty:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
}
.m-input-qty-done:focus {
  border-color: #22c55e !important;
  box-shadow: 0 0 0 3px rgba(34,197,94,0.15);
}
.m-search-input:focus {
  background: #fff !important;
  box-shadow: 0 0 0 2px #3b82f6;
}
.m-lookup-input:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
}
`;

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: embeddedCSS }} />
      <div style={{ minHeight: '100dvh', background: '#f3f4f6' }}>
        {children}
      </div>
    </>
  );
}
