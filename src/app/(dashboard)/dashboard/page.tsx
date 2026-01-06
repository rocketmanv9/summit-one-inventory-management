'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';

interface Session {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  fullName: string;
  expiresAt: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry: string;
  address?: any;
  metadata?: any;
}

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const sessionData = await response.json();
          setSession(sessionData);

          // Fetch tenant information
          const tenantResponse = await fetch('/api/tenant');
          if (tenantResponse.ok) {
            const { tenant } = await tenantResponse.json();
            setTenant(tenant);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Main Heading */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-muted-foreground">
            Manage your inventory items and stock levels
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: User Information */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold mb-4">
              User Information
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-muted-foreground">Name:</span>
                <p className="text-foreground">{session.fullName}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">Email:</span>
                <p className="text-foreground">{session.email}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">Role:</span>
                <p className="text-foreground capitalize">{session.role}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">User ID:</span>
                <p className="text-foreground font-mono text-sm">{session.userId}</p>
              </div>
            </div>
          </div>

          {/* Card 2: Active Tenant */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold mb-4">
              Active Tenant
            </h2>
            <div className="space-y-3">
              {tenant ? (
                <>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Company Name:</span>
                    <p className="text-foreground text-lg font-semibold">{tenant.name}</p>
                  </div>
                  {tenant.industry && (
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Industry:</span>
                      <p className="text-foreground">{tenant.industry}</p>
                    </div>
                  )}
                  {tenant.slug && (
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Slug:</span>
                      <p className="text-foreground font-mono text-sm">{tenant.slug}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Tenant ID:</span>
                    <p className="text-foreground font-mono text-xs">{tenant.id}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Tenant ID:</span>
                    <p className="text-foreground font-mono text-sm">{session.tenantId}</p>
                  </div>
                  <div className="mt-2 p-3 rounded-md border border-warning bg-warning/10">
                    <p className="text-sm text-warning-foreground">
                      Tenant details not yet synced from Core. Waiting for webhook events...
                    </p>
                  </div>
                </>
              )}
              <div className="mt-4 p-4 rounded-md border border-primary bg-primary/10">
                <p className="text-sm">
                  <strong>Note:</strong> All inventory data you see is automatically scoped to this tenant.
                  You can only view and manage items belonging to your organization.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Inventory Items */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold mb-4">
            Inventory Items
          </h2>
          <div className="p-8 text-center border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-2">
              Inventory items list will appear here
            </p>
            <p className="text-sm text-muted-foreground">
              All items are automatically filtered by tenant: <span className="font-mono">{session.tenantId}</span>
            </p>
            <div className="mt-4">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                onClick={() => alert('Item management coming soon!')}
              >
                Add New Item
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
