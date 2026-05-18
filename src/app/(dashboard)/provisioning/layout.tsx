'use client';

import NotificationBell from '@/components/provisioning/NotificationBell';

export default function ProvisioningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-40">
        <NotificationBell />
      </div>
      {children}
    </div>
  );
}
