'use client';

import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { PageTabs } from './PageTabs';
import { AiPanelProvider, useAiPanel } from '@/lib/ai/panel-store';
import { AiSidePanel } from '@/components/ai/AiSidePanel';
import { TenantBrandingProvider } from '@/lib/tenant-branding';

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
          <div className="container mx-auto p-6">
            <PageTabs />
            {children}
          </div>
        </main>
      </div>

      {/* AI Side Panel */}
      <AiSidePanel />
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <AiPanelProvider>
      <TenantBrandingProvider>
        <AppShellInner>{children}</AppShellInner>
      </TenantBrandingProvider>
    </AiPanelProvider>
  );
}
