'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { PageTabs } from './PageTabs';
import { ViewAsBanner } from './ViewAsBanner';
import { ViewAsBubble } from './ViewAsBubble';
import { AiPanelProvider, useAiPanel } from '@/lib/ai/panel-store';
import { AiSidePanel } from '@/components/ai/AiSidePanel';
import { TenantBrandingProvider } from '@/lib/tenant-branding';
import { ViewAsProvider, useViewAs } from '@/lib/view-as';
import { ALL_NAV_SECTIONS, sectionForPath } from '@/lib/nav';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Section access guard. Restricted positions (deny-by-default) can't navigate
 * into a section their position lacks — we bounce them to the first section
 * they CAN reach and never render the forbidden page's content.
 *
 * This is the view-layer counterpart to the server-side enforcement of the
 * *action* capabilities (vendors / purchase orders — see src/lib/access-server.ts).
 * Section data APIs are deliberately shared across sections (item pickers, etc.),
 * so navigation is gated here while mutations are gated at the route.
 *
 * Admins / developers / unconfigured users are never blocked (`enabled` →
 * full access), and we wait for `ready` so we never act on the loading state.
 */
function SectionAccessGuard({ children }: { children: React.ReactNode }) {
  const { can, ready, enabled } = useViewAs();
  const pathname = usePathname();
  const router = useRouter();

  const section = sectionForPath(pathname);
  const cap = section?.capability;
  const allowed = !cap || can(cap);
  const blocked = ready && !enabled && !allowed;

  useEffect(() => {
    if (!blocked) return;
    const target = ALL_NAV_SECTIONS.find((s) => !s.capability || can(s.capability));
    router.replace(target ? target.href : '/dashboard');
  }, [blocked, can, router]);

  if (blocked) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">You don&apos;t have access to this section</p>
        <p className="text-sm text-muted-foreground">Taking you back to where you can go…</p>
      </div>
    );
  }
  return <>{children}</>;
}

function AppShellInner({ children }: AppShellProps) {
  const { isOpen } = useAiPanel();

  return (
    <div className="relative flex h-screen overflow-hidden">
      {/* Sidebar - Fixed left */}
      <Sidebar />

      {/* Main content area */}
      <div
        className="flex flex-1 flex-col overflow-hidden pl-64 transition-[padding] duration-200"
        style={{ paddingRight: isOpen ? 400 : 0 }}
      >
        {/* Top navigation */}
        <TopNav />

        {/* Page content - Scrollable */}
        <main className="flex-1 overflow-y-auto bg-muted/30">
          <ViewAsBanner />
          <div className="container mx-auto p-6">
            <PageTabs />
            <SectionAccessGuard>{children}</SectionAccessGuard>
          </div>
        </main>
      </div>

      {/* AI Side Panel */}
      <AiSidePanel />

      {/* Floating "view as position" quick-switcher (admins/devs only) */}
      <ViewAsBubble />
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <AiPanelProvider>
      <TenantBrandingProvider>
        <ViewAsProvider>
          <AppShellInner>{children}</AppShellInner>
        </ViewAsProvider>
      </TenantBrandingProvider>
    </AiPanelProvider>
  );
}
