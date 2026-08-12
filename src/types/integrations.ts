/**
 * Shared types for the Gmail / Google integration (frontend + API contracts).
 */

export type GoogleConnectionType = 'user' | 'shared_mailbox';

/** Public-safe connection metadata (never includes token material). */
export interface GoogleConnectionPublic {
  id: string;
  connection_type: GoogleConnectionType;
  google_email: string;
  display_name: string | null;
  scopes: string[];
  connected_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

/** Response shape of GET /api/integrations/google/status. */
export interface GoogleStatusResponse {
  configured: boolean;
  connected: boolean;
  personal: GoogleConnectionPublic | null;
  shared_mailboxes: GoogleConnectionPublic[];
  connections: GoogleConnectionPublic[];
}

/** Response of GET /api/integrations/google/auth. */
export interface GoogleAuthUrlResponse {
  url: string;
}

export type POEmailProvider = 'gmail' | 'resend';

/** Result of POST /api/inventory/purchasing/po-email. */
export interface SendPOEmailResponse {
  sent: boolean;
  provider: POEmailProvider;
  message_id: string | null;
  thread_id: string | null;
  from: string;
  to: string;
  cc?: string;
  po_number: string;
}

/** Result of POST /api/integrations/google/sync-replies. */
export interface SyncRepliesResponse {
  scannedConnections: number;
  newReplies: number;
}

export type POEmailUrgency = 'normal' | 'urgent' | 'follow_up';

/** Result of GET /api/inventory/purchasing/po-email-draft. */
export interface POEmailDraftResponse {
  subject: string;
  body: string;
  vendor_name: string;
  recipient: string | null;
  urgency: POEmailUrgency;
}
