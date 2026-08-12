# Gmail OAuth Integration — Setup & Architecture

Multi-tenant Gmail integration that lets each user (or a shared company mailbox
like `purchasing@company.com`) send purchase orders from their own Google
account and read vendor replies back into the PO record.

---

## 1. What it does

- **Per-user OR shared-mailbox** Google connections (`connection_type`).
- Sends POs **from the connected Gmail** with a generated **PDF attachment**.
- **Prefers Gmail, falls back to Resend** when no Google account is connected —
  zero regression to the existing `purchasing@summit-one.app` flow.
- **Reads vendor replies** and links them to the originating PO by thread id or
  PO number.
- Refresh tokens are stored **encrypted in Supabase Vault** (same pattern as the
  Printify / Amazon integrations) — never in app tables, never sent to the browser.

---

## 2. Google Cloud setup

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Enable the Gmail API** for the project (APIs & Services → Library → Gmail API).
3. Configure the **OAuth consent screen**:
   - User type: **External** (or Internal for a single Workspace).
   - Add scopes: `openid`, `email`, `profile`,
     `https://www.googleapis.com/auth/gmail.send`,
     `https://www.googleapis.com/auth/gmail.readonly`.
   - While in **Testing**, add each connecting account under *Test users*. To go
     live for arbitrary tenants, submit for **verification** (the two Gmail
     scopes are *restricted* and require a security assessment).
4. Create an **OAuth client ID** → *Web application*.
   - **Authorized redirect URI:**
     `https://<your-app-host>/api/integrations/google/callback`
     (for local dev: `http://localhost:3000/api/integrations/google/callback`).
5. Copy the **Client ID** and **Client secret**.

---

## 3. Environment variables

Add to `.env.local` (and `.env.example` is already updated):

```bash
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
# Optional — otherwise derived from NEXT_PUBLIC_APP_URL:
GOOGLE_OAUTH_REDIRECT_URI=https://<your-app-host>/api/integrations/google/callback
# Optional — falls back to INTERNAL_JWT_SECRET:
GOOGLE_OAUTH_STATE_SECRET=<random 32+ char string>

# PO email identity (used on the email + PDF):
COMPANY_NAME=Acme Asphalt
COMPANY_ADDRESS=123 Main St\nSpringfield, IL 62704

# Resend fallback (already present in most environments):
RESEND_API_KEY=...
ORDER_EMAIL_FROM=purchasing@your-domain.com
```

---

## 4. Database migration

`supabase/migrations/20260603000002_gmail_oauth_integration.sql` creates three
`supply_chain` tables (all RLS-enabled, tenant-scoped):

| Table | Purpose |
|-------|---------|
| `google_connections` | OAuth connections (`user` / `shared_mailbox`). Stores a **Vault secret ref**, not the refresh token. |
| `purchase_order_emails` | Audit trail of every PO sent (Gmail or Resend) — who/when/recipient/message id. |
| `purchase_order_email_replies` | Vendor replies synced from Gmail, linked to the PO. |

> Applied to **stage** in this change. Apply to other environments with
> `supabase db push` or the dashboard migration runner.

RLS: `service_role` has full access (route handlers use the service client);
authenticated users may only **read** their own connections + tenant shared
mailboxes, and never see token material (it isn't a selectable column).

---

## 5. API surface

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/integrations/google/auth` | session | Build signed-state Google authorize URL |
| GET | `/api/integrations/google/callback` | session | Exchange code → store connection → redirect |
| GET | `/api/integrations/google/status` | session | Connection metadata (no tokens) |
| POST | `/api/integrations/google/disconnect` | session | Revoke + delete Vault secret |
| POST | `/api/integrations/google/sync-replies` | session | Pull vendor replies, link to POs |
| POST | `/api/inventory/purchasing/po-email` | session | Send a PO (prefers Gmail, falls back to Resend) |
| GET | `/api/inventory/purchasing/po-email-draft` | session | AI-drafted PO email text |

### State security
The `auth` route signs a short-lived (10 min) HS256 JWT containing
`tenant_id`, `user_id`, `nonce`, and `connection_type`. The callback verifies the
signature **and** cross-checks it against the live session before storing
anything.

---

## 6. Service layer (`src/lib`)

```
integrations/
  google-oauth.ts        OAuth URL, signed state, code exchange, token refresh, userinfo
  gmail.ts               RFC-5322 MIME build, messages.send, messages.list/get
  google-connections.ts  DB CRUD + getGoogleAccessTokenForUser() + shared-mailbox resolution
  vault.ts               Supabase Vault store/resolve/delete
po/
  po-context.ts          Loads PO + vendor + ship-to + bill-to + priced lines
  po-pdf.ts              pdf-lib PO document
  po-email-service.ts    sendPurchaseOrderEmail / generatePurchaseOrderEmailDraft / syncVendorReplies
```

### Key function (per spec)

```ts
import { getGoogleAccessTokenForUser } from '@/lib/integrations/google-connections';

// Loads the connection, decrypts the refresh token from Vault, refreshes it,
// and returns a valid access token (+ the connection it came from).
const { accessToken, connection } = await getGoogleAccessTokenForUser(tenantId, userId, {
  fetchImpl: tracedFetch, // pass the route's traced fetch
});
```

### Sending a PO

```ts
import { sendPurchaseOrderEmail } from '@/lib/po/po-email-service';

const result = await sendPurchaseOrderEmail({
  tenantId, userId,
  purchaseOrderId,
  requesterEmail: 'grant@acme.com',
  fetchImpl: tracedFetch,
  lastEventId: idempotencyKey,
});
// result.provider === 'gmail' | 'resend'
```

---

## 7. Shared mailboxes

A tenant that doesn't want POs coming from personal addresses connects a
**shared mailbox** (`connection_type = 'shared_mailbox'`). When present, the send
service prefers it over any individual's Gmail, so everything goes out from e.g.
`purchasing@company.com`. Admins add/remove shared mailboxes from
**Settings → Integrations → Gmail**.

---

## 8. UI

**Settings → Integrations → Gmail** (`src/components/settings/GmailIntegration.tsx`):
connect personal Gmail, add/remove shared mailboxes (admin), and a **Sync
replies** button. Connection status reflects `revoked_at`.

---

## 9. Notes & limits

- The two Gmail scopes are **restricted** — production use for external tenants
  requires Google's OAuth verification/security assessment. In *Testing* mode it
  works immediately for added test users.
- `prompt=consent` + `access_type=offline` ensures a refresh token. If a user
  previously authorized without one, they’ll see a `no_refresh_token` hint to
  remove the app at <https://myaccount.google.com/permissions> and retry.
- Reply sync runs **automatically** (see §10). The in-app buttons just force an
  immediate refresh.

---

## 10. Automatic vendor-reply sync (no manual button)

Replies are pulled and interpreted on a schedule — POs update themselves.

**Endpoint:** `GET /api/system/cron/gmail-reply-sync` — iterates every tenant
with an active Gmail connection and runs `syncAllTenantsReplies()`. It is
**secret-guarded**: it only runs when the request carries
`Authorization: Bearer <CRON_SECRET>`, so it isn't publicly triggerable.

**Setup:**
1. Set a `CRON_SECRET` env var (random 32+ chars) in each environment.
2. Scheduling is wired two ways — use whichever fits the deployment:

**a) Vercel Cron (default, already in `vercel.json`):**
```json
{ "crons": [ { "path": "/api/system/cron/gmail-reply-sync", "schedule": "*/10 * * * *" } ] }
```
Vercel automatically sends `Authorization: Bearer $CRON_SECRET`. Note: sub-daily
schedules require the **Pro** plan; Hobby runs crons at most once per day.

**b) Supabase pg_cron + pg_net (works on any plan / non-Vercel):**
```sql
-- Run every 10 minutes. Set the two GUCs once (app URL + cron secret).
select cron.schedule(
  'gmail-reply-sync',
  '*/10 * * * *',
  $$ select net.http_get(
       url := current_setting('app.inventory_url') || '/api/system/cron/gmail-reply-sync',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
     ) $$
);
```

**Bounds:** each run processes up to `maxTenants` (15) tenants with a 5-day
look-back to stay within the route timeout. For larger fleets, move the fan-out
to a queue or a Supabase Edge Function (the `syncVendorRepliesForTenant()` /
`syncAllTenantsReplies()` helpers are reusable from anywhere).

**Real-time option:** for instant updates instead of polling, use Gmail
`users.watch` → Google Pub/Sub → a webhook route that calls
`syncVendorRepliesForTenant()`. Heavier infra (a Pub/Sub topic + push
subscription), so polling is the default.
