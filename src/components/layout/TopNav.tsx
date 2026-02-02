'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Search, User, ChevronDown, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TopNav() {
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);

  // TODO: Get from auth context
  const tenantName = 'Acme Asphalt & Concrete';
  const userName = 'Admin User';
  const userRole = 'Administrator';

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      });

      if (response.ok) {
        router.push('/dev-login');
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-6">
      {/* Search */}
      <div className="flex-1">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search inventory, locations, assets..."
            className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
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
  );
}
