'use client';

import { useEffect, useState } from 'react';
import { Bug, Activity, RefreshCw, CheckCircle, Clock, XCircle, ArrowRight, BookOpen, Code, FileText } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { authenticatedFetch } from '@/lib/api-client';
import { createBrowserAuthedClient } from '@/supabase/client';
import { parseJwtPayload } from '@/lib/auth-token';

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

interface OutboxEvent {
  id: string;
  tenant_id: string;
  scope: string;
  event_name?: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: any;
  metadata: any;
  status: 'pending' | 'published' | 'failed';
  retry_count: number;
  last_error?: string;
  created_at: string;
  published_at?: string;
}

interface EventStats {
  total_events: number;
  pending_count: number;
  published_count: number;
  failed_count: number;
}

interface EventDefinition {
  id: string;
  event_name: string;
  event_version: number;
  producer: string;
  description: string;
  payload_schema: any;
  example_payload: any;
  status: 'active' | 'deprecated' | 'draft';
  created_at: string;
  updated_at: string;
}

export default function DebugPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [definitions, setDefinitions] = useState<EventDefinition[]>([]);
  const [lastEmitted, setLastEmitted] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    try {
      const supabase = createBrowserAuthedClient();
      const response = await authenticatedFetch('/api/auth/session');
      if (response.ok) {
        const sessionData = await response.json();
        const token = typeof window !== 'undefined' ? localStorage.getItem('custom_access_token') : null;
        const payload = token ? parseJwtPayload(token) : null;
        const userMeta = (payload?.user_metadata as Record<string, any> | undefined) || {};
        const tokenEmail = (payload as any)?.email || userMeta.email || '';
        const tokenName = userMeta.full_name || userMeta.name || '';
        const tokenRole = userMeta.role || (payload as any)?.role || '';
        const tokenExp = payload?.exp ? payload.exp * 1000 : 0;
        const mappedSession: Session = {
          userId: sessionData.user_id || sessionData.userId || '',
          email: sessionData.email || tokenEmail || '',
          tenantId: sessionData.tenant_id || sessionData.tenantId || '',
          role: sessionData.role || tokenRole || 'authenticated',
          fullName: sessionData.fullName || sessionData.full_name || tokenName || '',
          expiresAt: Number(sessionData.expiresAt || sessionData.expires_at || tokenExp || 0),
        };
        setSession(mappedSession);

        // Fetch tenant information
        const tenantId = mappedSession.tenantId;
        if (tenantId) {
          const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .maybeSingle();

          if (!tenantError && tenantData) {
            setTenant(tenantData as Tenant);
          }
        }

        // Fetch events data
        const { data: eventsData, error: eventsError } = await supabase
          .schema('inventory')
          .from('events_outbox')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (!eventsError) {
          const normalizedEvents = (eventsData || []) as OutboxEvent[];
          setEvents(normalizedEvents);

          const statsData: EventStats = {
            total_events: normalizedEvents.length,
            pending_count: normalizedEvents.filter(event => event.status === 'pending').length,
            published_count: normalizedEvents.filter(event => event.status === 'published').length,
            failed_count: normalizedEvents.filter(event => event.status === 'failed').length,
          };
          setStats(statsData);

          const emittedMap: Record<string, string> = {};
          normalizedEvents.forEach(event => {
            const eventName = event.event_type || event.event_name;
            if (!eventName) return;
            if (!emittedMap[eventName]) {
              emittedMap[eventName] = event.created_at;
            }
          });
          setLastEmitted(emittedMap);
        }

        const { data: defsData, error: defsError } = await supabase
          .from('event_definitions')
          .select('*')
          .order('event_name');

        if (!defsError) {
          setDefinitions((defsData || []) as EventDefinition[]);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

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

      {/* Events Monitoring */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Event Outbox Monitor
          </h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Events</span>
              </div>
              <p className="text-2xl font-bold">{stats.total_events}</p>
            </div>
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-yellow-600" />
                <span className="text-sm text-yellow-600">Pending</span>
              </div>
              <p className="text-2xl font-bold text-yellow-600">{stats.pending_count}</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-600">Published</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{stats.published_count}</p>
            </div>
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm text-red-600">Failed</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{stats.failed_count}</p>
            </div>
          </div>
        )}

        {/* Events List */}
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {events.length > 0 ? (
            events.map((event) => (
              <div
                key={event.id}
                className={`p-4 rounded-lg border ${
                  event.status === 'published'
                    ? 'bg-green-500/5 border-green-500/20'
                    : event.status === 'failed'
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-yellow-500/5 border-yellow-500/20'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {event.status === 'published' && (
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    )}
                    {event.status === 'pending' && (
                      <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                    )}
                    {event.status === 'failed' && (
                      <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold text-sm">{event.event_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.aggregate_type} <ArrowRight className="h-3 w-3 inline" /> {event.aggregate_id.substring(0, 8)}...
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full ${
                        event.status === 'published'
                          ? 'bg-green-600 text-white'
                          : event.status === 'failed'
                          ? 'bg-red-600 text-white'
                          : 'bg-yellow-600 text-white'
                      }`}
                    >
                      {event.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">Created:</span>{' '}
                    <span className="font-mono">{new Date(event.created_at).toLocaleTimeString()}</span>
                  </div>
                  {event.published_at && (
                    <div>
                      <span className="text-muted-foreground">Published:</span>{' '}
                      <span className="font-mono">{new Date(event.published_at).toLocaleTimeString()}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Retries:</span>{' '}
                    <span className="font-mono">{event.retry_count}</span>
                  </div>
                </div>

                {event.last_error && (
                  <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-600">
                    <strong>Error:</strong> {event.last_error}
                  </div>
                )}

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    View Payload
                  </summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              </div>
            ))
          ) : (
            <div className="p-8 text-center border-2 border-dashed rounded-lg bg-muted/30">
              <p className="text-muted-foreground">No events in the outbox yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Events will appear here as they are created and processed
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Event Catalog */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-purple-600" />
          Inventory Event Catalog
        </h2>
        
        <p className="text-sm text-muted-foreground mb-4">
          Registered inventory events available for emission and consumption. 
          All events follow the pattern: <code className="px-1.5 py-0.5 bg-muted rounded text-xs">inventory.{'{entity}'}.{'{action}'}</code>
        </p>

        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-600">Event Summary</span>
          </div>
          <div className="grid grid-cols-4 gap-4 mt-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total Events:</span>{' '}
              <span className="font-semibold">{definitions.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active:</span>{' '}
              <span className="font-semibold text-green-600">
                {definitions.filter(d => d.status === 'active').length}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Deprecated:</span>{' '}
              <span className="font-semibold text-orange-600">
                {definitions.filter(d => d.status === 'deprecated').length}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Draft:</span>{' '}
              <span className="font-semibold text-blue-600">
                {definitions.filter(d => d.status === 'draft').length}
              </span>
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          {definitions.length > 0 ? (
            definitions
              .sort((a, b) => a.event_name.localeCompare(b.event_name))
              .map((def) => (
              <div
                key={def.id}
                className={`p-4 rounded-lg border ${
                  def.status === 'active'
                    ? 'bg-green-500/5 border-green-500/20'
                    : def.status === 'deprecated'
                    ? 'bg-orange-500/5 border-orange-500/20'
                    : 'bg-blue-500/5 border-blue-500/20'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-lg">{def.event_name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-mono">
                        v{def.event_version}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          def.status === 'active'
                            ? 'bg-green-600 text-white'
                            : def.status === 'deprecated'
                            ? 'bg-orange-600 text-white'
                            : 'bg-blue-600 text-white'
                        }`}
                      >
                        {def.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{def.description}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium">Producer:</span>{' '}
                        <span className="font-mono">{def.producer}</span>
                      </div>
                      {lastEmitted[def.event_name] && (
                        <div>
                          <span className="font-medium">Last Emitted:</span>{' '}
                          <span className="font-mono">
                            {new Date(lastEmitted[def.event_name]).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium flex items-center gap-2 hover:text-foreground text-muted-foreground">
                      <Code className="h-4 w-4" />
                      Payload Schema
                    </summary>
                    <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(def.payload_schema, null, 2)}
                    </pre>
                  </details>

                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium flex items-center gap-2 hover:text-foreground text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      Example Payload
                    </summary>
                    <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(def.example_payload, null, 2)}
                    </pre>
                  </details>
                </div>

                {def.status === 'deprecated' && (
                  <div className="mt-3 p-2 bg-orange-500/10 rounded text-sm text-orange-600">
                    ⚠️ This event is deprecated. Please migrate to the latest version.
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-8 text-center border-2 border-dashed rounded-lg bg-muted/30">
              <BookOpen className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">No inventory events registered yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Inventory events will be automatically registered when you create domain actions
              </p>
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                Run: SELECT public.register_event(...) to add events
              </p>
            </div>
          )}
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
