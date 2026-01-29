# Security Refactor Checklist

## Audit Status: FAIL → IN PROGRESS

**Goal**: Convert ALL user routes from service role to JWT+RLS authentication

---

## Route Classification & Fix Status

### USER ROUTES (Dashboard/UI) - MUST USE JWT+RLS

| Route | Classification | Auth Status | Idempotency Status | Direct Writes | Status |
|-------|---------------|-------------|-------------------|---------------|---------|
| `/api/auth/dev-login` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/auth/session` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/auth/session-check` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/auth/logout` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/auth/me` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/dev-session` | USER/AUTH | TODO | N/A | N/A | TODO |
| `/api/tenant` | USER | TODO | TODO | YES | TODO |
| `/api/settings/tenant` | USER | TODO | TODO | YES | TODO |
| `/api/dashboards` | USER | TODO | TODO | YES | TODO |
| `/api/dashboards/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/dashboards/[id]/widgets` | USER | TODO | TODO | YES | TODO |
| `/api/dashboards/[id]/widgets/[widgetId]` | USER | TODO | TODO | YES | TODO |
| `/api/widgets` | USER | TODO | N/A | NO | TODO |
| `/api/widgets/data` | USER | TODO | N/A | NO | TODO |
| `/api/widgets/layout` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/items` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/items/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/categories` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/categories/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/locations` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/locations/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/locations/[id]/items` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/location-types` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/location-types/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assets` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assets/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assets/[id]/assign` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assets/[id]/return` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assets/[id]/history` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/assets/available` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/assignment-types` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/assignment-types/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/stock` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/movements` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/movements/[id]/reverse` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/transfers` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/transfers/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/transfers/[id]/ship` | USER | TODO | TODO (BROKEN) | YES | TODO |
| `/api/inventory/transfers/[id]/receive` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/transfers/[id]/cancel` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/transfers/[id]/undo-cancel` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/transfers/[id]/undo-ship` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/transfers/[id]/reverse` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/transfers/[id]/reverse-receipt` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/reservations` | USER | TODO | TODO (BROKEN) | NO | TODO |
| `/api/inventory/reservations/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/reservations/[id]/fulfill` | USER | TODO | TODO (OPTIONAL) | NO | TODO |
| `/api/inventory/reservations/[id]/release` | USER | TODO | TODO (OPTIONAL) | NO | TODO |
| `/api/inventory/reservations/[id]/undo-fulfill` | USER | TODO | TODO (OPTIONAL) | NO | TODO |
| `/api/inventory/reservations/[id]/undo-release` | USER | TODO | TODO (OPTIONAL) | NO | TODO |
| `/api/inventory/receiving` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/receiving/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/receiving/[id]/confirm` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/receiving/[id]/reverse` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/receiving/recent` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/receiving/draft` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/purchasing` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/purchasing/[id]` | USER | TODO | TODO (BROKEN) | YES | TODO |
| `/api/inventory/vendors` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/vendors/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/vendors/[id]/items` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/vendor-items` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/vendor-items/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/vendor-performance` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/vendor-performance/[id]/events` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/cycle-counts` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/cycle-counts/[id]/start` | USER | TODO | TODO (BROKEN) | YES | TODO |
| `/api/inventory/cycle-counts/[id]/submit` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/cycle-counts/[id]/approve` | USER | TODO | TODO | YES (CRITICAL) | TODO |
| `/api/inventory/cycle-counts/[id]/lines` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]/decide` | USER | TODO | TODO | YES | TODO |
| `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets` | USER | TODO | N/A | YES | TODO |
| `/api/inventory/alerts` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/alerts/[id]/acknowledge` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/alerts/[id]/dismiss` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/alerts/refresh` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/abc-classification` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/abc-classification/calculate` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/accounting/expenses` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/accounting/expenses/[id]` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/accounting/expenses/[id]/match` | USER | TODO | TODO | NO | TODO |
| `/api/inventory/audit` | USER | TODO | N/A | NO | TODO |
| `/api/inventory/reports/[id]` | USER | TODO | N/A | NO | TODO |
| `/api/supply-chain/receipts` | USER | TODO | N/A | NO | TODO |
| `/api/supply-chain/receipts/[id]` | USER | TODO | TODO | YES | TODO |
| `/api/supply-chain/receipts/[id]/confirm` | USER | TODO | TODO | NO | TODO |
| `/api/supply-chain/receipts/[id]/validate` | USER | TODO | N/A | NO | TODO |
| `/api/supply-chain/purchase-orders/[id]/receipts` | USER | TODO | N/A | NO | TODO |
| `/api/supply-chain/purchase-orders/[id]/receiving` | USER | TODO | N/A | NO | TODO |
| `/api/supply-chain/purchase-orders/receiving` | USER | TODO | N/A | NO | TODO |

### MACHINE ROUTES (RFID Devices) - CAN USE SERVICE ROLE AFTER DEVICE AUTH

| Route | Classification | Auth Status | Idempotency Status | Status |
|-------|---------------|-------------|-------------------|---------|
| `/api/inventory/rfid/devices/authenticate` | MACHINE | TODO | N/A | TODO |
| `/api/inventory/rfid/devices/heartbeat` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/devices/sync` | MACHINE | TODO | N/A | TODO |
| `/api/inventory/rfid/devices` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/tags` | MACHINE | TODO | N/A | TODO |
| `/api/inventory/rfid/tags/assign` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/tags/capture` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/bulk-assignment/start` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/bulk-assignment/[session_id]/add-tag` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/bulk-assignment/[session_id]/complete` | MACHINE | TODO | TODO | TODO |
| `/api/inventory/rfid/cycle-counts/submit` | MACHINE | TODO | TODO | TODO |

### WEBHOOK ROUTES - CAN USE SERVICE ROLE AFTER HMAC VERIFICATION

| Route | Classification | Auth Status | Idempotency Status | Status |
|-------|---------------|-------------|-------------------|---------|
| `/api/webhooks/core-events` | WEBHOOK | VERIFIED ✓ | VERIFIED ✓ | FIXED |

### DEBUG/TEST ROUTES - SHOULD USE JWT OR BE REMOVED IN PROD

| Route | Classification | Auth Status | Status |
|-------|---------------|-------------|---------|
| `/api/debug/events` | DEBUG | TODO | TODO |
| `/api/debug/event-catalog` | DEBUG | TODO | TODO |
| `/api/events/catalog` | DEBUG | TODO | TODO |
| `/api/test-events` | DEBUG | TODO | TODO |

---

## Summary

- **Total Routes**: 107
- **User Routes**: 95 (TODO: 90, FIXED: 5)
- **Machine Routes**: 11 (TODO: 11, FIXED: 0)
- **Webhook Routes**: 1 (TODO: 0, FIXED: 1)
- **Debug Routes**: 4 (TODO: 4, FIXED: 0)

---

## Critical Fixes Completed

### ✅ Routes Fixed (JWT + Idempotency + RPC-first)
1. `/api/inventory/stock` - JWT auth, no service role ✓
2. `/api/inventory/reservations` (GET/POST) - JWT auth, idempotency required ✓
3. `/api/inventory/cycle-counts/[id]/approve` - JWT auth, RPC-only (NO direct stock_balances) ✓
4. `/api/inventory/items` (already using secure pattern) ✓
5. `/api/inventory/vendors` (already using secure pattern) ✓
6. `/api/webhooks/core-events` (already verified) ✓

### ✅ Infrastructure Created
- `createUserClient()` in db-middleware.ts - JWT-based auth for user routes
- `getIdempotencyKey()` helper - enforces idempotency keys
- `createServiceClientVerified()` - service role only for webhooks/machines
- Legacy functions marked `@deprecated` with security warnings

### ✅ Critical Direct Write Eliminated
- **cycle-counts/[id]/approve**: Converted from direct `stock_balances.update()` to `post_cycle_count_adjustments` RPC
  - Now writes to `stock_movements` (source of truth)
  - Triggers handle materialization to `stock_balances`
  - Idempotent via `posted_at` check

---

## Summary

- **Total Routes**: 107
- **User Routes**: 95 (TODO: 95, FIXED: 0)
- **Machine Routes**: 11 (TODO: 11, FIXED: 0)
- **Webhook Routes**: 1 (TODO: 0, FIXED: 1)
- **Debug Routes**: 4 (TODO: 4, FIXED: 0)

---

## Critical Issues Found

1. **Service Role Everywhere**: All USER routes use `createClient()` from db-middleware which uses service role
2. **Idempotency Broken**: 15+ routes use `Date.now() + Math.random()` for last_event_id
3. **Direct Stock Updates**: `cycle-counts/[id]/approve` directly updates stock_balances (read model)
4. **Direct Writes**: 30+ routes perform direct INSERT/UPDATE/DELETE bypassing RPCs

---

## Next Steps

1. ✅ Create this checklist
2. ⏳ Create JWT-based user client helper
3. ⏳ Refactor all USER routes to use JWT client
4. ⏳ Add idempotency header/validation
5. ⏳ Convert direct writes to RPC calls
6. ⏳ Fix RFID machine auth
7. ⏳ Add security tests
