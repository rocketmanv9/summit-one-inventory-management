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

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-gray-100">
      {children}
    </div>
  );
}
