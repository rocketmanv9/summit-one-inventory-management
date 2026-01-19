'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { 
  BookOpen, 
  RefreshCw, 
  Activity, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  FileText,
  Code,
  Users
} from 'lucide-react';

interface EventDefinition {
  id: string;
  event_name: string;
  version: number;
  producer: string;
  description: string;
  payload_schema: any;
  example_payload: any;
  status: 'draft' | 'active' | 'deprecated';
  deprecation_reason?: string;
  deprecated_at?: string;
  created_at: string;
  updated_at: string;
}

interface EventStat {
  event_name: string;
  version: number;
  status: string;
  total_emitted: number;
  last_emitted_at: string | null;
  pending_count: number;
  published_count: number;
  failed_count: number;
}

interface EventConsumer {
  id: string;
  event_name: string;
  consumer_name: string;
  consumer_type: string;
  endpoint_url?: string;
  description?: string;
  active: boolean;
}

export default function EventCatalogPage() {
  const [definitions, setDefinitions] = useState<EventDefinition[]>([]);
  const [stats, setStats] = useState<EventStat[]>([]);
  const [consumers, setConsumers] = useState<EventConsumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  async function loadData() {
    try {
      const response = await fetch('/api/debug/event-catalog');
      if (response.ok) {
        const data = await response.json();
        setDefinitions(data.definitions);
        setStats(data.stats);
        setConsumers(data.consumers);
      }
    } catch (error) {
      console.error('Error loading event catalog:', error);
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

  function getStatsForEvent(eventName: string, version: number): EventStat | undefined {
    return stats.find(s => s.event_name === eventName && s.version === version);
  }

  function getConsumersForEvent(eventName: string): EventConsumer[] {
    return consumers.filter(c => c.event_name === eventName);
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading event catalog...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Event Catalog</h1>
              <p className="text-muted-foreground">
                Single source of truth for all events
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-card border">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Events</span>
            </div>
            <p className="text-2xl font-bold">{definitions.length}</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-600">Active</span>
            </div>
            <p className="text-2xl font-bold text-green-600">
              {definitions.filter(d => d.status === 'active').length}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-yellow-600">Draft</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">
              {definitions.filter(d => d.status === 'draft').length}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-600">Deprecated</span>
            </div>
            <p className="text-2xl font-bold text-red-600">
              {definitions.filter(d => d.status === 'deprecated').length}
            </p>
          </div>
        </div>

        {/* Events List */}
        <div className="space-y-4">
          {definitions.map((event) => {
            const eventStats = getStatsForEvent(event.event_name, event.version);
            const eventConsumers = getConsumersForEvent(event.event_name);
            const isExpanded = selectedEvent === `${event.event_name}-${event.version}`;

            return (
              <div
                key={event.id}
                className={`rounded-lg border bg-card transition-all ${
                  event.status === 'deprecated' ? 'opacity-60' : ''
                }`}
              >
                {/* Event Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    setSelectedEvent(
                      isExpanded ? null : `${event.event_name}-${event.version}`
                    )
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold font-mono">
                          {event.event_name}
                        </h3>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-muted">
                          v{event.version}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            event.status === 'active'
                              ? 'bg-green-500/20 text-green-700'
                              : event.status === 'draft'
                              ? 'bg-yellow-500/20 text-yellow-700'
                              : 'bg-red-500/20 text-red-700'
                          }`}
                        >
                          {event.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {event.description}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Code className="h-3 w-3" />
                          {event.producer}
                        </span>
                        {eventStats && (
                          <>
                            <span className="flex items-center gap-1">
                              <Activity className="h-3 w-3" />
                              {eventStats.total_emitted} emitted
                            </span>
                            {eventStats.last_emitted_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Last: {new Date(eventStats.last_emitted_at).toLocaleString()}
                              </span>
                            )}
                          </>
                        )}
                        {eventConsumers.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {eventConsumers.length} consumers
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {eventStats && (
                        <div className="flex gap-2">
                          {eventStats.pending_count > 0 && (
                            <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-700 rounded">
                              {eventStats.pending_count} pending
                            </span>
                          )}
                          {eventStats.published_count > 0 && (
                            <span className="px-2 py-1 text-xs bg-green-500/20 text-green-700 rounded">
                              {eventStats.published_count} published
                            </span>
                          )}
                          {eventStats.failed_count > 0 && (
                            <span className="px-2 py-1 text-xs bg-red-500/20 text-red-700 rounded">
                              {eventStats.failed_count} failed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4">
                    {/* Deprecation Warning */}
                    {event.status === 'deprecated' && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                        <p className="text-sm text-red-600 font-semibold">
                          ⚠️ DEPRECATED
                        </p>
                        {event.deprecation_reason && (
                          <p className="text-sm text-red-600 mt-1">
                            {event.deprecation_reason}
                          </p>
                        )}
                        {event.deprecated_at && (
                          <p className="text-xs text-red-600/70 mt-1">
                            Deprecated on: {new Date(event.deprecated_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Payload Schema */}
                    {event.payload_schema && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Payload Schema
                        </h4>
                        <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.payload_schema, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Example Payload */}
                    {event.example_payload && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <Code className="h-4 w-4" />
                          Example Payload
                        </h4>
                        <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.example_payload, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Consumers */}
                    {eventConsumers.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Consumers ({eventConsumers.length})
                        </h4>
                        <div className="space-y-2">
                          {eventConsumers.map((consumer) => (
                            <div
                              key={consumer.id}
                              className="p-2 bg-muted rounded text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-medium">{consumer.consumer_name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    ({consumer.consumer_type})
                                  </span>
                                </div>
                                <span
                                  className={`px-2 py-0.5 text-xs rounded ${
                                    consumer.active
                                      ? 'bg-green-500/20 text-green-700'
                                      : 'bg-gray-500/20 text-gray-700'
                                  }`}
                                >
                                  {consumer.active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                              {consumer.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {consumer.description}
                                </p>
                              )}
                              {consumer.endpoint_url && (
                                <p className="text-xs text-muted-foreground mt-1 font-mono">
                                  {consumer.endpoint_url}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {definitions.length === 0 && (
          <div className="p-8 text-center border-2 border-dashed rounded-lg bg-muted/30">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No events defined yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Run migrations to seed the event catalog
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
