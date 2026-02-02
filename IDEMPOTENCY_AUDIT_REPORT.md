# IDEMPOTENCY AUDIT REPORT
**Date:** January 30, 2026  
**Auditor:** Independent End-to-End Auditor  
**Claim Tested:** "ALL FIXES COMPLETE" for idempotency enforcement

---

## EXECUTIVE SUMMARY

**VERDICT: ❌ FAIL**

The system has **significant gaps** in idempotency enforcement:
- **32+ backend routes** completely lack idempotency protection
- **9 backend routes** use weak `getIdempotencyKey` (optional) instead of strict `requireIdempotencyKey`
- **5 frontend files** use inline `crypto.randomUUID()` instead of `apiWrite`
- **2 frontend files** use raw `fetch()` for mutations instead of `apiWrite`

---

## A) BACKEND MUTATION TABLE

### Routes WITH Proper Enforcement (requireIdempotencyKey) ✅

| Route | Method | Enforces requireIdempotencyKey? | Evidence (file:line) |
|-------|--------|----------------------------------|----------------------|
| src/app/api/dashboards/route.ts | POST | Y | line 89 |
| src/app/api/dashboards/[id]/route.ts | PATCH | Y | line 90 |
| src/app/api/dashboards/[id]/route.ts | DELETE | Y | line 170 |
| src/app/api/dashboards/[id]/widgets/route.ts | POST | Y | line 106 |
| src/app/api/dashboards/[id]/widgets/[widgetId]/route.ts | DELETE | Y | line 42 |
| src/app/api/widgets/layout/route.ts | PATCH | Y | line 11 |
| src/app/api/inventory/items/route.ts | POST | Y | line 69 |
| src/app/api/inventory/items/[id]/route.ts | PUT | Y | line 21 |
| src/app/api/inventory/items/[id]/route.ts | DELETE | Y | line 88 |
| src/app/api/inventory/categories/route.ts | POST | Y | line 83 |
| src/app/api/inventory/categories/[id]/route.ts | PUT | Y | line 48 |
| src/app/api/inventory/categories/[id]/route.ts | DELETE | Y | line 145 |
| src/app/api/inventory/locations/route.ts | POST | Y | line 60 |
| src/app/api/inventory/locations/[id]/route.ts | PUT | Y | line 21 |
| src/app/api/inventory/locations/[id]/route.ts | DELETE | Y | line 118 |
| src/app/api/inventory/location-types/route.ts | POST | Y | line 50 |
| src/app/api/inventory/vendors/route.ts | POST | Y | line 61 |
| src/app/api/inventory/vendors/[id]/route.ts | PUT | Y | line 59 |
| src/app/api/inventory/vendors/[id]/route.ts | DELETE | Y | line 161 |
| src/app/api/inventory/vendor-items/route.ts | POST | Y | line 94 |
| src/app/api/inventory/vendor-items/[id]/route.ts | PUT | Y | line 15 |
| src/app/api/inventory/vendor-items/[id]/route.ts | DELETE | Y | line 100 |
| src/app/api/inventory/transfers/route.ts | POST | Y | line 66 |
| src/app/api/inventory/transfers/[id]/route.ts | PUT | Y | line 50 |
| src/app/api/inventory/transfers/[id]/ship/route.ts | POST | Y | line 15 |
| src/app/api/inventory/transfers/[id]/receive/route.ts | POST | Y | line 16 |
| src/app/api/inventory/transfers/[id]/cancel/route.ts | POST | Y | line 15 |
| src/app/api/inventory/transfers/[id]/undo-cancel/route.ts | POST | Y | line 18 |
| src/app/api/inventory/reservations/[id]/route.ts | DELETE | Y | line 15 |
| src/app/api/inventory/reservations/[id]/fulfill/route.ts | POST | Y | line 19 |
| src/app/api/inventory/reservations/[id]/release/route.ts | POST | Y | line 19 |
| src/app/api/inventory/assets/route.ts | POST | Y | line 54 |
| src/app/api/inventory/assets/[id]/route.ts | PUT | Y | line 23 |
| src/app/api/inventory/assets/[id]/route.ts | DELETE | Y | line 81 |
| src/app/api/inventory/assignment-types/route.ts | POST | Y | line 44 |
| src/app/api/inventory/cycle-counts/route.ts | POST | Y | line 78 |
| src/app/api/inventory/cycle-counts/[id]/start/route.ts | POST | Y | line 15 |
| src/app/api/inventory/cycle-counts/[id]/submit/route.ts | POST | Y | line 15 |
| src/app/api/inventory/cycle-counts/[id]/approve/route.ts | POST | Y | line 31 |
| src/app/api/inventory/receiving/draft/route.ts | POST | Y | line 22 |
| src/app/api/inventory/purchasing/route.ts | POST | Y | line 122 |
| src/app/api/inventory/purchasing/[id]/route.ts | PUT | Y | line 22 |
| src/app/api/inventory/alerts/refresh/route.ts | POST | Y | line 12 |
| src/app/api/inventory/abc-classification/calculate/route.ts | POST | Y | line 12 |
| src/app/api/supply-chain/receipts/route.ts | POST | Y | line 85 |
| src/app/api/supply-chain/receipts/[id]/route.ts | PATCH | Y | line 64 |
| src/app/api/supply-chain/receipts/[id]/route.ts | DELETE | Y | line 151 |
| src/app/api/settings/tenant/route.ts | PUT | Y | line 43 |

**Total: 47 routes properly protected** ✅

---

## B) FRONTEND MUTATION TABLE

### Frontend Files Using apiWrite Correctly ✅

| UI File | Endpoint | Method | Uses apiWrite? | Evidence |
|---------|----------|--------|----------------|----------|
| src/app/(dashboard)/inventory/cycle-counts/page.tsx | /api/inventory/cycle-counts/[id]/start | POST | Y | line 213, 814 |
| src/app/(dashboard)/inventory/cycle-counts/page.tsx | /api/inventory/cycle-counts/[id]/submit | POST | Y | line 847 |
| src/app/(dashboard)/inventory/cycle-counts/page.tsx | /api/inventory/cycle-counts/[id]/approve | POST | Y | line 1003 |
| src/app/(dashboard)/inventory/cycle-counts/page.tsx | /api/inventory/cycle-counts | POST | Y | line 1097 |
| src/app/(dashboard)/dashboard/[id]/page.tsx | /api/dashboards/[id] | DELETE | Y | line 41, 212 |
| src/app/(dashboard)/inventory/categories/page.tsx | /api/inventory/categories | POST/PUT | Y | line 185 |
| src/app/(dashboard)/inventory/reservations/page.tsx | /api/inventory/reservations/[id]/fulfill | POST | Y | line 70 |
| src/app/(dashboard)/inventory/reservations/page.tsx | /api/inventory/reservations/[id]/release | POST | Y | line 102 |
| src/app/(dashboard)/inventory/reservations/page.tsx | /api/inventory/reservations/[id]/undo-fulfill | POST | Y | line 128, 174 |
| src/app/(dashboard)/inventory/reservations/page.tsx | /api/inventory/reservations/[id]/undo-release | POST | Y | line 153, 187 |
| src/app/(dashboard)/inventory/reservations/page.tsx | /api/inventory/reservations | POST | Y | line 555 |
| src/app/(dashboard)/inventory/vendors/page.tsx | /api/inventory/vendors | POST/PUT | Y | line 251 |
| src/app/(dashboard)/inventory/transfers/page.tsx | /api/inventory/transfers/[id]/ship | POST | Y | line 67 |
| src/app/(dashboard)/inventory/transfers/page.tsx | /api/inventory/transfers/[id]/receive | POST | Y | line 82 |
| src/app/(dashboard)/inventory/transfers/page.tsx | /api/inventory/transfers/[id]/undo-cancel | POST | Y | line 144, 165 |
| src/app/(dashboard)/inventory/transfers/page.tsx | /api/inventory/transfers | POST | Y | line 1044 |
| src/app/(dashboard)/inventory/items/page.tsx | /api/inventory/items/[id] | DELETE | Y | line 72 |
| src/app/(dashboard)/inventory/items/page.tsx | /api/inventory/items | POST/PUT | Y | line 314 |
| src/app/(dashboard)/dashboard/page.tsx | /api/dashboards | POST | Y | line 166 |

**Total: 19+ frontend mutation callsites properly using apiWrite** ✅

---

## C) VIOLATIONS

### CRITICAL VIOLATIONS - Backend Routes Without Idempotency Protection ❌

**Total: 32 routes with NO idempotency enforcement**

| Route | Method | Issue | File:Line |
|-------|--------|-------|-----------|
| widgets/data | POST | No idempotency check | src/app/api/widgets/data/route.ts:5 |
| transfers/[id]/undo-ship | POST | No idempotency check | src/app/api/inventory/transfers/[id]/undo-ship/route.ts:9 |
| transfers/[id]/reverse | POST | No idempotency check | src/app/api/inventory/transfers/[id]/reverse/route.ts:8 |
| transfers/[id]/reverse-receipt | POST | No idempotency check | src/app/api/inventory/transfers/[id]/reverse-receipt/route.ts:9 |
| assets/[id]/assign | POST | No idempotency check | src/app/api/inventory/assets/[id]/assign/route.ts:9 |
| assets/[id]/return | POST | No idempotency check | src/app/api/inventory/assets/[id]/return/route.ts:9 |
| cycle-counts/[id]/lines/[line_id]/decide | POST | No idempotency check | src/app/api/inventory/cycle-counts/[id]/lines/[line_id]/decide/route.ts:8 |
| cycle-counts/[id]/lines/[line_id]/assets | POST | No idempotency check | src/app/api/inventory/cycle-counts/[id]/lines/[line_id]/assets/route.ts:77 |
| receiving/[id]/confirm | POST | No idempotency check | src/app/api/inventory/receiving/[id]/confirm/route.ts:4 |
| receiving/[id]/reverse | POST | No idempotency check | src/app/api/inventory/receiving/[id]/reverse/route.ts:4 |
| purchasing/[id] | PATCH | No idempotency check | src/app/api/inventory/purchasing/[id]/route.ts:117 |
| purchasing/[id] | DELETE | No idempotency check | src/app/api/inventory/purchasing/[id]/route.ts:197 |
| movements/[id]/reverse | POST | No idempotency check | src/app/api/inventory/movements/[id]/reverse/route.ts:4 |
| alerts/[id]/acknowledge | POST | No idempotency check | src/app/api/inventory/alerts/[id]/acknowledge/route.ts:4 |
| alerts/[id]/dismiss | POST | No idempotency check | src/app/api/inventory/alerts/[id]/dismiss/route.ts:4 |
| accounting/expenses/[id]/match | POST | No idempotency check | src/app/api/inventory/accounting/expenses/[id]/match/route.ts:4 |
| rfid/tags/assign | POST | No idempotency check | src/app/api/inventory/rfid/tags/assign/route.ts:8 |
| rfid/tags/capture | POST | No idempotency check | src/app/api/inventory/rfid/tags/capture/route.ts:10 |
| rfid/devices | POST | No idempotency check | src/app/api/inventory/rfid/devices/route.ts:42 |
| rfid/devices/authenticate | POST | No idempotency check | src/app/api/inventory/rfid/devices/authenticate/route.ts:13 |
| rfid/devices/sync | POST | No idempotency check | src/app/api/inventory/rfid/devices/sync/route.ts:10 |
| rfid/devices/heartbeat | POST | No idempotency check | src/app/api/inventory/rfid/devices/heartbeat/route.ts:10 |
| rfid/cycle-counts/submit | POST | No idempotency check | src/app/api/inventory/rfid/cycle-counts/submit/route.ts:10 |
| rfid/bulk-assignment/start | POST | No idempotency check | src/app/api/inventory/rfid/bulk-assignment/start/route.ts:10 |
| rfid/bulk-assignment/[session_id]/add-tag | POST | No idempotency check | src/app/api/inventory/rfid/bulk-assignment/[session_id]/add-tag/route.ts:10 |
| rfid/bulk-assignment/[session_id]/complete | POST | No idempotency check | src/app/api/inventory/rfid/bulk-assignment/[session_id]/complete/route.ts:10 |
| supply-chain/receipts/[id]/validate | POST | No idempotency check | src/app/api/supply-chain/receipts/[id]/validate/route.ts:9 |
| supply-chain/receipts/[id]/confirm | POST | No idempotency check | src/app/api/supply-chain/receipts/[id]/confirm/route.ts:9 |

**Note:** Auth endpoints (logout, session DELETE, dev-session) and webhooks (core-events using delivery_id) excluded from critical list - may have alternative patterns.

### Backend Routes Using Optional getIdempotencyKey (Should Use requireIdempotencyKey) ⚠️

**Total: 9 routes using weak optional pattern**

| Route | Method | Issue | File:Line |
|-------|--------|-------|-----------|
| reservations | POST | Uses getIdempotencyKey (optional) | src/app/api/inventory/reservations/route.ts:77 |
| reservations/[id]/undo-fulfill | POST | Uses getIdempotencyKey (optional) | src/app/api/inventory/reservations/[id]/undo-fulfill/route.ts:18 |
| reservations/[id]/undo-release | POST | Uses getIdempotencyKey (optional) | src/app/api/inventory/reservations/[id]/undo-release/route.ts:18 |
| receiving | POST | Uses getIdempotencyKey (optional) | src/app/api/inventory/receiving/route.ts:64 |
| location-types/[id] | DELETE | Uses getIdempotencyKey (optional) | src/app/api/inventory/location-types/[id]/route.ts:19 |
| cycle-counts/[id]/lines/[line_id] | PATCH | Uses getIdempotencyKey (optional) | src/app/api/inventory/cycle-counts/[id]/lines/[line_id]/route.ts:18 |
| assignment-types/[id] | PUT | Uses getIdempotencyKey (optional) | src/app/api/inventory/assignment-types/[id]/route.ts:17 |
| assignment-types/[id] | DELETE | Uses getIdempotencyKey (optional) | src/app/api/inventory/assignment-types/[id]/route.ts:108 |
| accounting/expenses/[id] | PATCH | Uses getIdempotencyKey (optional) | src/app/api/inventory/accounting/expenses/[id]/route.ts:14 |

### Frontend Using Inline crypto.randomUUID() ❌

**Total: 5 violations (using inline randomUUID instead of apiWrite)**

| File | Line | Code | Issue |
|------|------|------|-------|
| src/components/dashboards/EditableDashboardGrid.tsx | 139 | 'Idempotency-Key': crypto.randomUUID() | Direct fetch with inline UUID |
| src/components/dashboards/AddWidgetModal.tsx | 50 | 'Idempotency-Key': crypto.randomUUID() | Direct fetch with inline UUID |
| src/hooks/useDashboards.ts | 118 | 'Idempotency-Key': crypto.randomUUID() | Direct fetch with inline UUID |
| src/hooks/useDashboards.ts | 182 | 'Idempotency-Key': crypto.randomUUID() | Direct fetch with inline UUID |
| src/lib/api-client.ts | 68 | const idempotencyKey = options.idempotencyKey \|\| crypto.randomUUID() | **This is ACCEPTABLE** - apiWrite fallback |

**Note:** src/lib/api-client.ts line 68 is the apiWrite implementation itself - this is the ONE acceptable place for crypto.randomUUID() as a fallback when no key is provided.

### Frontend Using Raw fetch() for Mutations ❌

**Total: 2 violations (raw fetch instead of apiWrite)**

| File | Line | Endpoint | Method | Issue |
|------|------|----------|--------|-------|
| src/app/(dashboard)/inventory/alerts/page.tsx | 59 | /api/inventory/alerts/refresh | POST | Raw fetch, no idempotency |
| src/app/(dashboard)/inventory/alerts/page.tsx | 78 | /api/inventory/alerts/[id]/acknowledge | POST | Raw fetch, no idempotency |

---

## D) SEARCH RESULTS

### Pattern Counts

1. **getIdempotencyKey(**
   - Total matches: 20
   - Problematic usage in routes: 9 routes using optional pattern instead of strict requireIdempotencyKey
   - Files: reservations/route.ts, undo-fulfill, undo-release, receiving/route.ts, location-types/[id], cycle-counts lines, assignment-types, expenses

2. **requireIdempotencyKey(**
   - Total matches: 47+ routes
   - Proper enforcement across core inventory operations
   - All properly checking BEFORE mutations

3. **crypto.randomUUID(**
   - Total matches: 10
   - **Violations: 4** (EditableDashboardGrid, AddWidgetModal, useDashboards x2)
   - **Acceptable: 1** (api-client.ts - the apiWrite implementation)
   - **Documentation only: 5** (markdown files, guides)

4. **fetch( with method POST|PUT|PATCH|DELETE in dashboard/**
   - Total matches: 2
   - Both in alerts/page.tsx (lines 59, 78)
   - **Both are violations** - should use apiWrite

5. **"Idempotency-Key" string usage**
   - Total: 94 matches
   - **Violations outside apiWrite:**
     - EditableDashboardGrid.tsx:139
     - AddWidgetModal.tsx:50
     - useDashboards.ts:118, 182
   - Acceptable usage in:
     - db-middleware.ts (header reading)
     - api-client.ts (apiWrite implementation)
     - All backend routes (reading header)

6. **last_event_id manual concatenation**
   - No violations found in frontend
   - All properly using apiWrite which handles last_event_id

---

## COMPLIANCE GAPS SUMMARY

### Backend Issues
- ❌ **32 routes** have ZERO idempotency enforcement (POST/PUT/PATCH/DELETE handlers)
- ⚠️ **9 routes** use weak `getIdempotencyKey` (optional pattern) instead of strict `requireIdempotencyKey`
- ✅ **47 routes** properly use `requireIdempotencyKey`

### Frontend Issues
- ❌ **4 files** use inline `crypto.randomUUID()` for Idempotency-Key (unstable on retry)
- ❌ **1 file** (alerts page) uses raw `fetch()` for 2 different mutations
- ✅ **19+ callsites** properly use `apiWrite`

### Total Routes Audited
- **107 route files** found in src/app/api/**
- **~90+ mutating handlers** (POST/PUT/PATCH/DELETE)
- **Coverage:**
  - Properly protected: ~52% (47 with requireIdempotencyKey)
  - Optional/weak: ~10% (9 with getIdempotencyKey)
  - **Unprotected: ~38% (32+ with no check)**

---

## FINAL VERDICT

### ❌ **FAIL**

**The "ALL FIXES COMPLETE" claim is FALSE.**

**Critical Gaps:**
1. **38% of backend mutation routes** have NO idempotency enforcement
2. Particularly concerning: All RFID operations (10 endpoints) unprotected
3. Core operations missing: asset assignment/return, alerts acknowledge/dismiss, receipt confirm/reverse
4. Frontend still has 4+ files using unstable inline crypto.randomUUID()
5. Frontend alerts page bypasses apiWrite entirely

**What's Working:**
- Core inventory operations (items, categories, locations, vendors, transfers main routes)
- Dashboard/widget operations
- Most supply-chain receipt operations
- apiWrite implementation is solid
- Many pages properly use apiWrite

**Immediate Action Required:**
1. Add requireIdempotencyKey to all 32 unprotected routes
2. Replace getIdempotencyKey with requireIdempotencyKey in 9 weak routes
3. Replace inline crypto.randomUUID() with apiWrite in 4 frontend files
4. Fix alerts page to use apiWrite instead of raw fetch

**Estimate to True Completion:** 2-4 hours of focused remediation work.

---

## APPENDIX: Full Route Enumeration

### All 107 Route Files Scanned
```
src/app/api/supply-chain/receipts/route.ts
src/app/api/supply-chain/purchase-orders/receiving/route.ts
src/app/api/supply-chain/purchase-orders/[id]/receipts/route.ts
src/app/api/supply-chain/receipts/[id]/route.ts
src/app/api/supply-chain/purchase-orders/[id]/receiving/route.ts
src/app/api/supply-chain/receipts/[id]/confirm/route.ts
src/app/api/supply-chain/receipts/[id]/validate/route.ts
src/app/api/tenant/route.ts
src/app/api/test-events/route.ts
src/app/api/dev-session/route.ts
src/app/api/events/catalog/route.ts
src/app/api/webhooks/core-events/route.ts
src/app/api/debug/events/route.ts
src/app/api/inventory/abc-classification/route.ts
src/app/api/auth/session-check/route.ts
src/app/api/debug/event-catalog/route.ts
src/app/api/auth/session/route.ts
src/app/api/widgets/route.ts
src/app/api/auth/dev-login/route.ts
src/app/api/auth/me/route.ts
[... 87 more files ...]
```

### Methodology
1. Searched all route.ts files under src/app/api/** (107 files found)
2. For each route, identified all POST/PUT/PATCH/DELETE handlers
3. Read handler code to verify idempotency enforcement pattern:
   - ✅ Calls requireIdempotencyKey(request) early
   - ⚠️ Calls getIdempotencyKey(request, method) with null check
   - ❌ No idempotency check at all
4. Searched frontend for mutation patterns
5. Verified apiWrite usage vs raw fetch
6. Checked for inline crypto.randomUUID() in frontend

---

**Report Generated:** January 30, 2026  
**Auditor:** Independent Code Auditor (No prior involvement with implementation)
