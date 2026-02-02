# Idempotency Enforcement Audit Report

**Generated:** 2026-01-30T20:25:57.700Z  
**Total Mutating Handlers:** 90

## Summary

| Status | Count |
|--------|-------|
| ✅ PASS (strict requireIdempotencyKey) | 90 |
| ⚠️ WEAK (optional getIdempotencyKey) | 0 |
| ❌ FAIL (no enforcement) | 0 |

**VERDICT:** ✅ ALL ROUTES COMPLIANT

## ✅ PASS: Strict Enforcement

| Route | Method | File:Line |
|-------|--------|----------|
| dev-login | POST | [src\app\api\auth\dev-login\route.ts](src\app\api\auth\dev-login\route.ts#L10) |
| logout | POST | [src\app\api\auth\logout\route.ts](src\app\api\auth\logout\route.ts#L5) |
| session | DELETE | [src\app\api\auth\session\route.ts](src\app\api\auth\session\route.ts#L54) |
| dashboards | POST | [src\app\api\dashboards\route.ts](src\app\api\dashboards\route.ts#L74) |
| [id] | PATCH | [src\app\api\dashboards\[id]\route.ts](src\app\api\dashboards\[id]\route.ts#L72) |
| [id] | DELETE | [src\app\api\dashboards\[id]\route.ts](src\app\api\dashboards\[id]\route.ts#L152) |
| widgets | POST | [src\app\api\dashboards\[id]\widgets\route.ts](src\app\api\dashboards\[id]\widgets\route.ts#L88) |
| [widgetId] | DELETE | [src\app\api\dashboards\[id]\widgets\[widgetId]\route.ts](src\app\api\dashboards\[id]\widgets\[widgetId]\route.ts#L24) |
| dev-session | POST | [src\app\api\dev-session\route.ts](src\app\api\dev-session\route.ts#L10) |
| calculate | POST | [src\app\api\inventory\abc-classification\calculate\route.ts](src\app\api\inventory\abc-classification\calculate\route.ts#L4) |
| match | POST | [src\app\api\inventory\accounting\expenses\[id]\match\route.ts](src\app\api\inventory\accounting\expenses\[id]\match\route.ts#L4) |
| [id] | PATCH | [src\app\api\inventory\accounting\expenses\[id]\route.ts](src\app\api\inventory\accounting\expenses\[id]\route.ts#L4) |
| refresh | POST | [src\app\api\inventory\alerts\refresh\route.ts](src\app\api\inventory\alerts\refresh\route.ts#L4) |
| acknowledge | POST | [src\app\api\inventory\alerts\[id]\acknowledge\route.ts](src\app\api\inventory\alerts\[id]\acknowledge\route.ts#L4) |
| dismiss | POST | [src\app\api\inventory\alerts\[id]\dismiss\route.ts](src\app\api\inventory\alerts\[id]\dismiss\route.ts#L4) |
| assets | POST | [src\app\api\inventory\assets\route.ts](src\app\api\inventory\assets\route.ts#L46) |
| assign | POST | [src\app\api\inventory\assets\[id]\assign\route.ts](src\app\api\inventory\assets\[id]\assign\route.ts#L9) |
| return | POST | [src\app\api\inventory\assets\[id]\return\route.ts](src\app\api\inventory\assets\[id]\return\route.ts#L9) |
| [id] | PUT | [src\app\api\inventory\assets\[id]\route.ts](src\app\api\inventory\assets\[id]\route.ts#L10) |
| [id] | DELETE | [src\app\api\inventory\assets\[id]\route.ts](src\app\api\inventory\assets\[id]\route.ts#L68) |
| assignment-types | POST | [src\app\api\inventory\assignment-types\route.ts](src\app\api\inventory\assignment-types\route.ts#L36) |
| [id] | PUT | [src\app\api\inventory\assignment-types\[id]\route.ts](src\app\api\inventory\assignment-types\[id]\route.ts#L5) |
| [id] | DELETE | [src\app\api\inventory\assignment-types\[id]\route.ts](src\app\api\inventory\assignment-types\[id]\route.ts#L90) |
| categories | POST | [src\app\api\inventory\categories\route.ts](src\app\api\inventory\categories\route.ts#L68) |
| [id] | PUT | [src\app\api\inventory\categories\[id]\route.ts](src\app\api\inventory\categories\[id]\route.ts#L30) |
| [id] | DELETE | [src\app\api\inventory\categories\[id]\route.ts](src\app\api\inventory\categories\[id]\route.ts#L127) |
| cycle-counts | POST | [src\app\api\inventory\cycle-counts\route.ts](src\app\api\inventory\cycle-counts\route.ts#L70) |
| approve | POST | [src\app\api\inventory\cycle-counts\[id]\approve\route.ts](src\app\api\inventory\cycle-counts\[id]\approve\route.ts#L13) |
| assets | POST | [src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\assets\route.ts](src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\assets\route.ts#L77) |
| decide | POST | [src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\decide\route.ts](src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\decide\route.ts#L8) |
| [line_id] | PATCH | [src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\route.ts](src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\route.ts#L8) |
| start | POST | [src\app\api\inventory\cycle-counts\[id]\start\route.ts](src\app\api\inventory\cycle-counts\[id]\start\route.ts#L4) |
| submit | POST | [src\app\api\inventory\cycle-counts\[id]\submit\route.ts](src\app\api\inventory\cycle-counts\[id]\submit\route.ts#L4) |
| items | POST | [src\app\api\inventory\items\route.ts](src\app\api\inventory\items\route.ts#L56) |
| [id] | PUT | [src\app\api\inventory\items\[id]\route.ts](src\app\api\inventory\items\[id]\route.ts#L10) |
| [id] | DELETE | [src\app\api\inventory\items\[id]\route.ts](src\app\api\inventory\items\[id]\route.ts#L77) |
| location-types | POST | [src\app\api\inventory\location-types\route.ts](src\app\api\inventory\location-types\route.ts#L42) |
| [id] | DELETE | [src\app\api\inventory\location-types\[id]\route.ts](src\app\api\inventory\location-types\[id]\route.ts#L9) |
| locations | POST | [src\app\api\inventory\locations\route.ts](src\app\api\inventory\locations\route.ts#L52) |
| [id] | PUT | [src\app\api\inventory\locations\[id]\route.ts](src\app\api\inventory\locations\[id]\route.ts#L10) |
| [id] | DELETE | [src\app\api\inventory\locations\[id]\route.ts](src\app\api\inventory\locations\[id]\route.ts#L107) |
| reverse | POST | [src\app\api\inventory\movements\[id]\reverse\route.ts](src\app\api\inventory\movements\[id]\reverse\route.ts#L4) |
| purchasing | POST | [src\app\api\inventory\purchasing\route.ts](src\app\api\inventory\purchasing\route.ts#L114) |
| [id] | PUT | [src\app\api\inventory\purchasing\[id]\route.ts](src\app\api\inventory\purchasing\[id]\route.ts#L10) |
| [id] | PATCH | [src\app\api\inventory\purchasing\[id]\route.ts](src\app\api\inventory\purchasing\[id]\route.ts#L117) |
| [id] | DELETE | [src\app\api\inventory\purchasing\[id]\route.ts](src\app\api\inventory\purchasing\[id]\route.ts#L207) |
| draft | POST | [src\app\api\inventory\receiving\draft\route.ts](src\app\api\inventory\receiving\draft\route.ts#L10) |
| receiving | POST | [src\app\api\inventory\receiving\route.ts](src\app\api\inventory\receiving\route.ts#L53) |
| confirm | POST | [src\app\api\inventory\receiving\[id]\confirm\route.ts](src\app\api\inventory\receiving\[id]\confirm\route.ts#L4) |
| reverse | POST | [src\app\api\inventory\receiving\[id]\reverse\route.ts](src\app\api\inventory\receiving\[id]\reverse\route.ts#L4) |
| reservations | POST | [src\app\api\inventory\reservations\route.ts](src\app\api\inventory\reservations\route.ts#L69) |
| fulfill | POST | [src\app\api\inventory\reservations\[id]\fulfill\route.ts](src\app\api\inventory\reservations\[id]\fulfill\route.ts#L7) |
| release | POST | [src\app\api\inventory\reservations\[id]\release\route.ts](src\app\api\inventory\reservations\[id]\release\route.ts#L7) |
| [id] | DELETE | [src\app\api\inventory\reservations\[id]\route.ts](src\app\api\inventory\reservations\[id]\route.ts#L4) |
| undo-fulfill | POST | [src\app\api\inventory\reservations\[id]\undo-fulfill\route.ts](src\app\api\inventory\reservations\[id]\undo-fulfill\route.ts#L7) |
| undo-release | POST | [src\app\api\inventory\reservations\[id]\undo-release\route.ts](src\app\api\inventory\reservations\[id]\undo-release\route.ts#L7) |
| start | POST | [src\app\api\inventory\rfid\bulk-assignment\start\route.ts](src\app\api\inventory\rfid\bulk-assignment\start\route.ts#L10) |
| add-tag | POST | [src\app\api\inventory\rfid\bulk-assignment\[session_id]\add-tag\route.ts](src\app\api\inventory\rfid\bulk-assignment\[session_id]\add-tag\route.ts#L10) |
| complete | POST | [src\app\api\inventory\rfid\bulk-assignment\[session_id]\complete\route.ts](src\app\api\inventory\rfid\bulk-assignment\[session_id]\complete\route.ts#L10) |
| submit | POST | [src\app\api\inventory\rfid\cycle-counts\submit\route.ts](src\app\api\inventory\rfid\cycle-counts\submit\route.ts#L10) |
| authenticate | POST | [src\app\api\inventory\rfid\devices\authenticate\route.ts](src\app\api\inventory\rfid\devices\authenticate\route.ts#L13) |
| heartbeat | POST | [src\app\api\inventory\rfid\devices\heartbeat\route.ts](src\app\api\inventory\rfid\devices\heartbeat\route.ts#L10) |
| devices | POST | [src\app\api\inventory\rfid\devices\route.ts](src\app\api\inventory\rfid\devices\route.ts#L42) |
| sync | POST | [src\app\api\inventory\rfid\devices\sync\route.ts](src\app\api\inventory\rfid\devices\sync\route.ts#L10) |
| assign | POST | [src\app\api\inventory\rfid\tags\assign\route.ts](src\app\api\inventory\rfid\tags\assign\route.ts#L8) |
| capture | POST | [src\app\api\inventory\rfid\tags\capture\route.ts](src\app\api\inventory\rfid\tags\capture\route.ts#L10) |
| transfers | POST | [src\app\api\inventory\transfers\route.ts](src\app\api\inventory\transfers\route.ts#L58) |
| cancel | POST | [src\app\api\inventory\transfers\[id]\cancel\route.ts](src\app\api\inventory\transfers\[id]\cancel\route.ts#L4) |
| receive | POST | [src\app\api\inventory\transfers\[id]\receive\route.ts](src\app\api\inventory\transfers\[id]\receive\route.ts#L4) |
| reverse | POST | [src\app\api\inventory\transfers\[id]\reverse\route.ts](src\app\api\inventory\transfers\[id]\reverse\route.ts#L8) |
| reverse-receipt | POST | [src\app\api\inventory\transfers\[id]\reverse-receipt\route.ts](src\app\api\inventory\transfers\[id]\reverse-receipt\route.ts#L9) |
| [id] | PUT | [src\app\api\inventory\transfers\[id]\route.ts](src\app\api\inventory\transfers\[id]\route.ts#L38) |
| ship | POST | [src\app\api\inventory\transfers\[id]\ship\route.ts](src\app\api\inventory\transfers\[id]\ship\route.ts#L4) |
| undo-cancel | POST | [src\app\api\inventory\transfers\[id]\undo-cancel\route.ts](src\app\api\inventory\transfers\[id]\undo-cancel\route.ts#L7) |
| undo-ship | POST | [src\app\api\inventory\transfers\[id]\undo-ship\route.ts](src\app\api\inventory\transfers\[id]\undo-ship\route.ts#L9) |
| vendor-items | POST | [src\app\api\inventory\vendor-items\route.ts](src\app\api\inventory\vendor-items\route.ts#L86) |
| [id] | PUT | [src\app\api\inventory\vendor-items\[id]\route.ts](src\app\api\inventory\vendor-items\[id]\route.ts#L4) |
| [id] | DELETE | [src\app\api\inventory\vendor-items\[id]\route.ts](src\app\api\inventory\vendor-items\[id]\route.ts#L89) |
| vendors | POST | [src\app\api\inventory\vendors\route.ts](src\app\api\inventory\vendors\route.ts#L49) |
| [id] | PUT | [src\app\api\inventory\vendors\[id]\route.ts](src\app\api\inventory\vendors\[id]\route.ts#L45) |
| [id] | DELETE | [src\app\api\inventory\vendors\[id]\route.ts](src\app\api\inventory\vendors\[id]\route.ts#L147) |
| tenant | PUT | [src\app\api\settings\tenant\route.ts](src\app\api\settings\tenant\route.ts#L35) |
| receipts | POST | [src\app\api\supply-chain\receipts\route.ts](src\app\api\supply-chain\receipts\route.ts#L77) |
| confirm | POST | [src\app\api\supply-chain\receipts\[id]\confirm\route.ts](src\app\api\supply-chain\receipts\[id]\confirm\route.ts#L9) |
| [id] | PATCH | [src\app\api\supply-chain\receipts\[id]\route.ts](src\app\api\supply-chain\receipts\[id]\route.ts#L53) |
| [id] | DELETE | [src\app\api\supply-chain\receipts\[id]\route.ts](src\app\api\supply-chain\receipts\[id]\route.ts#L140) |
| validate | POST | [src\app\api\supply-chain\receipts\[id]\validate\route.ts](src\app\api\supply-chain\receipts\[id]\validate\route.ts#L9) |
| core-events | POST | [src\app\api\webhooks\core-events\route.ts](src\app\api\webhooks\core-events\route.ts#L32) |
| data | POST | [src\app\api\widgets\data\route.ts](src\app\api\widgets\data\route.ts#L4) |
| layout | PATCH | [src\app\api\widgets\layout\route.ts](src\app\api\widgets\layout\route.ts#L4) |


## Remediation

### For FAIL routes:
Add this at the start of each mutating handler:
```typescript
const { requireIdempotencyKey } = await import('@/lib/db-middleware');
const idempotencyKey = await requireIdempotencyKey(request);
```

### For WEAK routes:
Replace `getIdempotencyKey` with `requireIdempotencyKey` (same pattern as above).

