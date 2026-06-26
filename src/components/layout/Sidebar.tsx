'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import { useTenantBranding } from '@/lib/tenant-branding';
import { useViewAs } from '@/lib/view-as';
import { NAV_SECTIONS, SETTINGS_SECTION, DEBUG_ITEM, isSectionActive, matchHref } from '@/lib/nav';

export function Sidebar() {
  const pathname = usePathname();
  const { session } = useSession();
  const isDeveloper = session?.isDeveloper === true;
  const { branding } = useTenantBranding();
  const { can } = useViewAs();

  // In a "view as position" preview, hide sections that position can't access.
  const visibleSections = NAV_SECTIONS.filter((s) => can(s.capability));
  const canSettings = can(SETTINGS_SECTION.capability);

  const logoUrl = branding.logo_url ?? null;

  const footerLinkClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
    );

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={branding.display_name}
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">
              {branding.display_name}
            </h1>
            <p className="text-xs text-muted-foreground">Inventory</p>
          </div>
        </div>
      </div>

      {/* Navigation — one link per top-level destination */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleSections.map((section) => {
            const isActive = isSectionActive(pathname, section);
            const Icon = section.icon;

            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{section.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer — Settings, plus Debug for developers */}
      <div className="space-y-1 border-t border-sidebar-border p-4">
        {isDeveloper && (
          <Link href={DEBUG_ITEM.href} className={footerLinkClass(matchHref(pathname, DEBUG_ITEM.href))}>
            <DEBUG_ITEM.icon className="h-4 w-4" />
            <span>{DEBUG_ITEM.title}</span>
          </Link>
        )}
        {canSettings && (
          <Link href={SETTINGS_SECTION.href} className={footerLinkClass(isSectionActive(pathname, SETTINGS_SECTION))}>
            <SETTINGS_SECTION.icon className="h-4 w-4" />
            <span>{SETTINGS_SECTION.title}</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
