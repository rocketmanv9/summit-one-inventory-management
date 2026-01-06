'use client';

import { useEffect, useState } from 'react';
import { Bug } from 'lucide-react';
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

export default function DebugPage() {
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
      <AppShell>
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading debug data...</p>
        </div>
      </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
          <Bug className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Debug Information</h1>
          <p className="text-muted-foreground">
            System state and session details for troubleshooting
          </p>
        </div>
      </div>

      {/* Session Information */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-success animate-pulse"></span>
          User Session
        </h2>
        {session ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Full Name</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{session.fullName}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Email</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{session.email}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">User ID</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{session.userId}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Role</p>
                <p className="font-mono text-sm bg-muted p-2 rounded capitalize">{session.role}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Tenant ID</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{session.tenantId}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Session Expires At</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">
                  {new Date(session.expiresAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Raw Session Data</p>
              <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                {JSON.stringify(session, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-destructive">No session data available</p>
        )}
      </div>

      {/* Tenant Information */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse"></span>
          Active Tenant
        </h2>
        {tenant ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Tenant Name</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{tenant.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Tenant ID</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{tenant.id}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Slug</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{tenant.slug}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Industry</p>
                <p className="font-mono text-sm bg-muted p-2 rounded">{tenant.industry}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Raw Tenant Data</p>
              <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                {JSON.stringify(tenant, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="p-4 border border-warning bg-warning/10 rounded-md">
            <p className="text-sm">
              <strong>⚠️ No tenant data available</strong>
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Tenant details not yet synced from Core. Waiting for webhook events...
            </p>
          </div>
        )}
      </div>

      {/* Inventory Items Placeholder */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse"></span>
          Inventory Items
        </h2>
        <div className="p-8 text-center border-2 border-dashed rounded-lg bg-muted/30">
          <p className="text-muted-foreground mb-2">
            No inventory items to display yet
          </p>
          <p className="text-sm text-muted-foreground">
            Items will be filtered by tenant: <span className="font-mono">{session?.tenantId}</span>
          </p>
        </div>
      </div>

      {/* Environment Info */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Environment</h2>
        <div className="space-y-2 font-mono text-sm">
          <div className="flex justify-between p-2 bg-muted rounded">
            <span className="text-muted-foreground">Next.js Version:</span>
            <span>16.1.1</span>
          </div>
          <div className="flex justify-between p-2 bg-muted rounded">
            <span className="text-muted-foreground">Node ENV:</span>
            <span>{process.env.NODE_ENV || 'development'}</span>
          </div>
          <div className="flex justify-between p-2 bg-muted rounded">
            <span className="text-muted-foreground">Timestamp:</span>
            <span>{new Date().toISOString()}</span>
          </div>
        </div>
      </div>
    </div>
    </AppShell>
  );
}
