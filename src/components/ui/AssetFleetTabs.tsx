'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Assets', href: '/inventory/assets' },
  { label: 'Tools', href: '/fleet/tools' },
  { label: 'Vehicles', href: '/fleet/vehicles' },
  { label: 'Equipment', href: '/fleet/equipment' },
];

export function AssetFleetTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-2 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            pathname === tab.href
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
