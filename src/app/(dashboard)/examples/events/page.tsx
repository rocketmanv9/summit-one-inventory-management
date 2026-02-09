/**
 * Example: Real-Time Event Subscriptions
 * 
 * This page demonstrates how to use the new supply_chain.* event names
 * for real-time dashboard updates.
 * 
 * @see /FRONTEND_EVENT_MIGRATION_GUIDE.md for migration guide
 * @see /EVENT_CATALOG.md for complete event reference
 */

import { EventSubscriptions } from './EventSubscriptions';

export default function EventSubscriptionExamplePage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Real-Time Event Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Demonstrating the new <code className="bg-muted px-1 py-0.5 rounded">supply_chain.*</code> event naming convention
        </p>
      </div>

      <EventSubscriptions />
    </div>
  );
}
