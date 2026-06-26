'use client';

import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { PageTabs } from './PageTabs';
import { ViewAsBanner } from './ViewAsBanner';
import { ViewAsBubble } from './ViewAsBubble';
import { AiPanelProvider, useAiPanel } from '@/lib/ai/panel-store';
import { AiSidePanel } from '@/components/ai/AiSidePanel';
import { TenantBrandingProvider } from '@/lib/tenant-branding';
import { ViewAsProvider } from '@/lib/view-as';

interface AppShellProps {
  children: React.ReactNode;
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
            {children}
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
