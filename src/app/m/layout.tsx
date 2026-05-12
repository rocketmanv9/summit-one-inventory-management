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
.m-input:focus {
  outline: none;
  border-color: #3b82f6 !important;
}
.m-input-counted:focus {
  border-color: #22c55e !important;
}
.m-input::placeholder {
  color: #9ca3af;
}
.m-search:focus {
  outline: none;
  box-shadow: 0 0 0 2px #3b82f6;
  background: #fff;
}
.m-search::placeholder {
  color: #9ca3af;
}
.m-btn:active {
  transform: scale(0.98);
}
.m-asset-btn:active {
  transform: scale(0.98);
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
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
