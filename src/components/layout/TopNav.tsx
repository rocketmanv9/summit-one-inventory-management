'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Search, User, ChevronDown, LogOut, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/client';
import { CommandPalette } from '@/components/search/CommandPalette';
import { useAiPanel } from '@/lib/ai/panel-store';

export function TopNav() {
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const aiPanel = useAiPanel();

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  // TODO: Get from auth context
  const tenantName = 'Acme Asphalt & Concrete';
  const userName = 'Admin User';
  const userRole = 'Administrator';

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  };

  return (
    <>
      <CommandPalette />
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-6">
        {/* Search trigger */}
        <div className="flex-1">
          <button
            onClick={openSearch}
            className="relative flex h-10 w-full max-w-md items-center rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
          >
            <Search className="mr-3 h-4 w-4" />
            <span>Search inventory, locations, assets...</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              {isMac ? '\u2318' : 'Ctrl+'}K
            </kbd>
          </button>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* AI Assistant Toggle */}
          <button
            onClick={aiPanel.toggle}
            className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              aiPanel.isOpen
                ? 'bg-blue-100 text-blue-700'
                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Toggle AI assistant"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">AI</span>
            <kbd className="ml-1 hidden rounded border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              {isMac ? '\u2318' : 'Ctrl+'}J
            </kbd>
          </button>

          {/* Notifications */}
          <button
            className="relative rounded-lg p-2 hover:bg-muted"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
            </span>
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-border" />

          {/* Tenant Info */}
          <div className="hidden text-right lg:block">
            <p className="text-sm font-medium">{tenantName}</p>
            <p className="text-xs text-muted-foreground">
              Tenant ID: ae837809
            </p>
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                {userName.charAt(0)}
              </div>
              <div className="hidden text-left lg:block">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-muted-foreground">{userRole}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>

            {/* User Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-popover shadow-md">
                <div className="p-2">
                  <a
                    href="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </a>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleLogout();
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-destructive hover:bg-muted"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
