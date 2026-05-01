'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [session, setSession] = useState<{ name: string; email: string; tenantId: string; role: string } | null>(null);
  const aiPanel = useAiPanel();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setSession({ name: data.name, email: data.email, tenantId: data.tenantId, role: data.role });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userName = session?.name ?? 'Loading...';
  const userRole = session?.role ?? 'Loading...';
  const tenantName = session?.name ?? 'Loading...';
  const tenantId = session?.tenantId ? session.tenantId.substring(0, 8) : '...';

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
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-border" />

          {/* Tenant Info */}
          <div className="hidden text-right lg:block">
            <p className="text-sm font-medium">{tenantName}</p>
            <p className="text-xs text-muted-foreground">
              Tenant ID: {tenantId}
            </p>
          </div>

          {/* User Menu */}
          <div className="relative" ref={menuRef}>
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
