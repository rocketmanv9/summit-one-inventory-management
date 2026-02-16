# Summit One Inventory Management System

## Project Overview

Summit One is a sophisticated **Event-Driven Architecture (EDA)** inventory management system built on Next.js with advanced multitenant support and token-based authentication. It manages complex supply chain operations including purchase orders, receiving, stock movements, asset management, cycle counts, and more.

**Key Characteristics:**
- **Multitenant**: Every entity is scoped to a `tenant_id`
- **Event-Driven**: State changes flow through a well-defined event system
- **Token-Based Auth**: JWT-based authentication with tenant isolation
- **Fully Typed**: TypeScript throughout the stack
- **Full-Stack**: Next.js API routes + React frontend with Tailwind

---

## Technology Stack

- **Framework**: Next.js 15.5.12 (App Router)
- **Frontend**: React 19.2.4 with Tailwind CSS + Radix UI
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT tokens (jose library) + Cookie-based session
- **Types**: TypeScript 5
- **Testing**: Jest + React Testing Library
- **UI Components**: Radix UI + custom components

---

## Architecture Patterns

### 1. Multitenant Isolation
**Core Principle**: All data operations must be scoped to the current tenant.

```typescript
// Auth context always provides tenant_id
interface AuthContext {
  userId: string;
  tenantId: string;
  userEmail?: string;
}

// Get tenant from auth in API routes
const auth = await requireAuth(); // throws if not authenticated
const tenantId = auth.tenantId;
```

**Rules for Agents**:
- Always query/filter by `tenant_id`
- Include `tenant_id` in all new records
- Never expose data from other tenants
- See `src/lib/auth.ts` for auth utilities

### 2. Event-Driven Architecture
The system uses **event sourcing** for state management. Events are the source of truth.

**Event Categories:**
- **Supply Chain Events** (12 total): Vendor, Purchase Order, Receipt operations
- **Inventory Events** (34 total): Stock, Assets, Transfers, Reservations, Cycle Counts, Adjustments

**Event Structure**:
```typescript
interface BaseEvent<TPayload = any> {
  id: string;
  tenant_id: string;
  event_name: string;  // e.g., 'supply_chain.purchase_order.created'
  event_version: number;
  payload: TPayload;
  correlation_id?: string;  // Links related events
  causation_id?: string;    // Links cause to effect
  actor_user_id?: string;
  created_at: string;
}
```

**Rules for Agents**:
- Events are **immutable** - never update or delete existing events
- Create new events for state changes
- Use `correlation_id` and `causation_id` to trace event chains
- Always include `tenant_id`, `actor_user_id`, and timestamp
- See `src/types/events.ts` for complete event catalog

### 3. Authentication & Authorization
Uses JWT tokens stored in cookies with tenant information embedded.

**JWT Payload Structure**:
```typescript
{
  sub: string;                    // user ID
  app_metadata: {
    tenant_id: string;           // tenant scope
    [key: string]: unknown;
  };
  user_metadata: {
    email: string;
    [key: string]: unknown;
  };
}
```

**Auth Flow**:
1. Public paths: `/api/auth/*`, `/api/health`, `/api/mock/*`, `/api/debug/*`
2. Protected paths: Require valid `access_token` cookie
3. Cookie checked in middleware + API routes
4. Token decoded to extract `userId` and `tenantId`

**Key Functions** (`src/lib/auth.ts`):
- `getAuthContext()` - Returns auth or null
- `requireAuth()` - Throws if not authenticated (use in protected routes)
- `getCurrentTenantId()` - Gets tenant (throws if not auth)
- `getCurrentUserId()` - Gets user (throws if not auth)
- `clearAuth()` - Logout helper

---

## Directory Structure

```
src/
├── app/
│   ├── (dashboard)/          # Protected routes (require auth)
│   │   ├── dashboard/        # Main dashboard
│   │   ├── inventory/        # Inventory management pages
│   │   ├── operations/       # Operations (receiving, issuing)
│   │   ├── purchasing/       # Purchase order management
│   │   └── settings/         # Configuration pages
│   ├── api/
│   │   ├── auth/            # Auth endpoints (login, refresh, logout)
│   │   ├── chat/            # AI chat API
│   │   ├── mock/            # Mock SSO for testing
│   │   ├── debug/           # Debug utilities
│   │   └── health/          # Health check
│   └── layout.tsx           # Root layout
├── lib/
│   ├── auth.ts              # Auth utilities & context
│   ├── auth-token.ts        # Token management
│   ├── api-client.ts        # HTTP client for API calls
│   ├── api-error-handler.ts # Error handling
│   ├── rpc/                 # RPC-style API calls (inventory, supply-chain)
│   ├── supabase/            # Supabase client setup
│   ├── chat/                # Chat system (intents, actions)
│   └── utils.ts             # General utilities
├── types/
│   ├── events.ts            # Event type definitions & catalog
│   ├── inventory.ts         # Inventory domain types
│   ├── purchase-orders.ts   # PO domain types
│   └── dashboard.ts         # Dashboard state types
└── components/
    ├── chat/                # Chat UI components
    └── [various UI components organized by feature]

```

---

## Key Patterns & Conventions

### API Routes
All API routes should:
1. Use `requireAuth()` to get tenant & user context
2. Filter results by `tenant_id`
3. Return appropriate HTTP status codes
4. Handle errors with `ApiErrorHandler`

**Example**:
```typescript
// src/app/api/example/route.ts
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const auth = await requireAuth(); // Throws 401 if not auth
  const tenantId = auth.tenantId;

  // Query with tenant filter
  const data = await db
    .from('items')
    .eq('tenant_id', tenantId)
    .select();

  return Response.json(data);
}
```

### Server Components
Leverage Next.js server components for:
- Direct database access (no extra API call)
- Secure auth checks
- Cleaner code flow

```typescript
import { requireAuth } from '@/lib/auth';

export default async function Page() {
  const auth = await requireAuth();
  // Use auth.tenantId, auth.userId directly
}
```

### RPC-Style Functions
Located in `src/lib/rpc/`, these are typed functions that call the backend:

```typescript
// src/lib/rpc/inventory.ts
import { requireAuth } from '@/lib/auth';

export async function getItemsByTenant() {
  const auth = await requireAuth();
  // Implementation
}
```

### Event Handling
When processing events:
1. Extract relevant data from payload
2. Update derived state/views
3. Create downstream events if needed
4. Maintain causal chains via `correlation_id`/`causation_id`

---

## Important Tenant Isolation Rules

**CRITICAL**: These must be followed to prevent data leaks:

1. **Always Filter by tenant_id**
   ```typescript
   // ❌ WRONG
   const items = await db.from('items').select();

   // ✅ CORRECT
   const items = await db
     .from('items')
     .eq('tenant_id', tenantId)
     .select();
   ```

2. **Include tenant_id in New Records**
   ```typescript
   // ✅ Always add tenant_id
   await db.from('items').insert({
     id: generateId(),
     tenant_id: auth.tenantId,  // Include this
     name: 'Item Name',
     // ... other fields
   });
   ```

3. **Never Trust User Input for tenant_id**
   ```typescript
   // ❌ WRONG - User could change tenantId in request
   const result = await db
     .from('items')
     .eq('tenant_id', req.body.tenantId)  // Dangerous!
     .select();

   // ✅ CORRECT - Use auth context
   const result = await db
     .from('items')
     .eq('tenant_id', auth.tenantId)
     .select();
   ```

---

## Event Catalog Reference

### Supply Chain Events
- `supply_chain.vendor.created`
- `supply_chain.vendor.updated`
- `supply_chain.purchase_order.created`
- `supply_chain.purchase_order.submitted`
- `supply_chain.purchase_order.approved`
- `supply_chain.purchase_order.in_transit`
- `supply_chain.purchase_order.received`
- `supply_chain.purchase_order.cancelled`
- `supply_chain.purchase_order.closed`
- `supply_chain.receipt.created`
- `supply_chain.receipt.line_added`
- `supply_chain.receipt.posted`

### Inventory Events
- Stock Events: `stock.replenished`, `stock.issued`, `stock.returned`, `stock.adjusted`, `stock.low_threshold_reached`, `stock.out_of_stock`
- Asset Events: `asset.created`, `asset.updated`, `asset.assigned`, `asset.returned`, `asset.retired`
- Transfer Events: `transfer.created`, `transfer.completed`, `transfer.cancelled`
- Reservation Events: `reservation.created`, `reservation.fulfilled`, `reservation.cancelled`, `reservation.expired`
- Cycle Count Events: `cycle_count.started`, `cycle_count.line_counted`, `cycle_count.approved`, `cycle_count.posted`
- Adjustment Events: `adjustment.created`, `adjustment.approved`, `adjustment.rejected`

See `src/types/events.ts` for complete type definitions and payloads.

---

## Authentication Flows

### Login Flow
1. User authenticates with core auth system
2. System sets `access_token` and `refresh_token` cookies
3. Middleware validates token on protected routes
4. Token decoded server-side to extract tenant & user info

### Protected API Route Pattern
```typescript
export async function GET(request: NextRequest) {
  const auth = await requireAuth(); // Middleware ensures cookie exists
  // auth.tenantId, auth.userId now available
  // Proceed with tenant-scoped operations
}
```

### Refresh Token Flow
- `access_token`: Short-lived, in payload
- `refresh_token`: Long-lived, used to get new access_token
- See `src/app/api/auth/refresh/route.ts`

---

## Common Development Tasks

### Adding a New Inventory Feature
1. Define event types in `src/types/events.ts`
2. Create API route in `src/app/api/[feature]/route.ts`
   - Use `requireAuth()` for tenant context
   - Filter all queries by `tenant_id`
3. Emit events on state changes
4. Create frontend component/page in `src/app/(dashboard)/[feature]/`
5. Use server components where possible for clean architecture

### Handling Multitenant Concerns
- Always use `auth.tenantId` from `requireAuth()`
- Never accept `tenant_id` from request body/params
- Test across different tenants to ensure isolation

### Event Processing
- Check `event_name` against event catalog
- Extract fields from `payload`
- Maintain `correlation_id`/`causation_id` chains
- Create derived records (views) but preserve event immutability

---

## Development Scripts

```bash
npm run dev              # Start dev server + Supabase
npm run build           # Build for production
npm run lint            # Run ESLint
npm run check:idempotency  # Verify API idempotency
npm run sb:start        # Start Supabase locally
npm run sb:stop         # Stop Supabase (no backup)
```

---

## Important Files for Agents

- **`src/lib/auth.ts`**: Auth context & utilities - READ THIS FIRST
- **`src/types/events.ts`**: Event definitions - Reference for EDA work
- **`middleware.ts`**: Auth middleware - Understand route protection
- **`src/lib/api-error-handler.ts`**: Error handling pattern
- **`.env.example`**: Environment configuration reference

---

## Notes for AI Agents

1. **Tenant Isolation is Non-Negotiable**: Always verify you're filtering by `tenant_id` from auth context, never from user input.

2. **Event Immutability**: Events are the source of truth. Create new events rather than modifying old ones.

3. **TypeScript Advantages**: Full types in `src/types/` reduce ambiguity. Check types before implementing.

4. **Server Components First**: Use Next.js server components for backend logic - simpler and more secure than API routes for many tasks.

5. **Auth is Secure**: The middleware + JWT pattern is battle-tested. Don't bypass it with extra checks or workarounds.

6. **Test Multitenant**: Features should work across different tenants independently. Consider this when designing.

7. **Error Handling**: Use `ApiErrorHandler` in `src/lib/api-error-handler.ts` for consistent error responses.

8. **Correlation Tracking**: Use `correlation_id` to trace event chains - helps with debugging and auditing.

---

## Success Criteria for This Repo

✅ All API routes are tenant-scoped
✅ Events are immutable and well-typed
✅ Auth is consistent across all protected routes
✅ Frontend respects tenant boundaries
✅ Tests verify multitenant isolation
✅ New features follow existing patterns

---

## Questions or Issues?

- Check `src/types/events.ts` for event catalog
- Check `src/lib/auth.ts` for authentication patterns
- Check existing API routes for implementation patterns
- Look at `middleware.ts` to understand route protection
