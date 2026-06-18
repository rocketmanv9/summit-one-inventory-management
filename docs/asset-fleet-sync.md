# Asset ↔ Fleet bidirectional sync

Serialized **assets** in Inventory and **vehicles/equipment** in Fleet are kept in
sync over the Command Center (CC) event bus. Add or edit in either service and the
change propagates to the other. GV is **not** involved — it's only an onboarding
catalog.

## Flow

```
Inventory user adds/edits an asset (Fleet Type = vehicle|equipment)
  → emit_asset_event trigger → public.events_outbox (asset.created/updated/retired)
  → CC poller → POST fleet /api/webhooks/core-events
  → applyInventoryAssetEvent → rpc_apply_inventory_asset_sync → fleet_assets

Fleet user adds/edits an asset (vehicle|equipment)
  → fleet_asset.onboarded/updated/retired (route `events` array)
  → CC poller → POST inventory /api/webhooks/fleet-events
  → rpc_apply_fleet_asset_sync → inventory.assets
```

## Identity & echo prevention

- Each side stores the other's id: `inventory.assets.fleet_asset_id` ↔
  `fleet_assets.inventory_asset_id`. Correlation order on apply: link id → serial →
  vin → create. `source_system` marks where a row originated.
- **Echo guard (inventory only):** inventory emits via a DB trigger, so
  `rpc_apply_fleet_asset_sync` sets the `app.sync_in_progress` GUC and
  `emit_asset_event` skips emission for that write. Fleet emits from route handlers
  (not triggers), so its sync writes never emit — no guard needed there.
- Net: a user edit emits exactly one event; the other side applies it without
  re-emitting. No ping-pong.

## Scope

- **In scope now:** `vehicle`, `equipment`. Inventory classifies via the
  `asset_kind` column ("Fleet Type" on the create modal); blank = inventory-only,
  never synced. Fleet uses `asset_type`.
- **Deferred:** `tool` — Fleet doesn't model tools yet (migration 00041 dropped
  tool assignments). `asset_kind='tool'` is carried but not mirrored to Fleet.

## Status mapping

| Inventory | Fleet |
|---|---|
| available / assigned | active |
| in_repair | out_of_service |
| out_of_service | out_of_service |
| retired | retired |

(reverse: active/pending → available, sold → retired)

## Command Center subscriptions

- **Inventory → Fleet:** `asset.created/updated/retired` appended to the existing
  "summit-one-fleet-management - Inventory Locations (stage)" subscription
  (fleet `core-events`, existing secret). Live, no new secret.
- **Fleet → Inventory:** "Inventory - Fleet Assets (stage)" → inventory
  `/api/webhooks/fleet-events`, event_types `fleet_asset.*`. **Requires
  `FLEET_WEBHOOK_SECRET` on the inventory deployment** equal to the subscription's
  `secret`.

## Backfill (existing rows)

New/edited rows sync automatically. Pre-existing rows do not emit an event, so a
one-time backfill is needed to mirror them. Match by `inventory_asset_id` /
`fleet_asset_id` then serial/vin; for unmatched fleet vehicles/equipment, call
`inventory.rpc_apply_fleet_asset_sync` per row (and the reverse for inventory
assets). Not run automatically — it's a deliberate bulk operation.
