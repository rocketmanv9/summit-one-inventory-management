/**
 * Ticket Validator
 * Validates SSO tickets by exchanging them with Core for user data
 */

export interface SSOUser {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  org_id?: string;
  name?: string;
}

export interface TicketValidationError {
  code: 'INVALID_TICKET' | 'EXPIRED_TICKET' | 'CORE_UNAVAILABLE' | 'INVALID_RESPONSE';
  message: string;
}

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
const TICKET_VALIDATION_TIMEOUT = 5000; // 5 seconds

/**
 * Validate an SSO ticket by exchanging it with Core
 * @param ticket - The 64-hex ticket from Core
 * @returns User data if valid, error if not
 */
export async function validateTicket(
  ticket: string
): Promise<{ user: SSOUser } | { error: TicketValidationError }> {
  // Validate ticket format (should be 64-char hex)
  if (!ticket || !/^[a-f0-9]{64}$/i.test(ticket)) {
    return {
      error: {
        code: 'INVALID_TICKET',
        message: 'Ticket format invalid'
      }
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TICKET_VALIDATION_TIMEOUT);

    const response = await fetch(`${CORE_URL}/api/auth/validate-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ticket,
        service: 'inventory'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle non-200 responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 404) {
        return {
          error: {
            code: 'INVALID_TICKET',
            message: 'Ticket not found or expired'
          }
        };
      }

      return {
        error: {
          code: 'CORE_UNAVAILABLE',
          message: `Core validation failed: ${errorData.message || response.statusText}`
        }
      };
    }

    // Parse user data
    const data = await response.json();
    
    // Validate response structure
    if (!data.user || !data.user.id || !data.user.tenant_id) {
      return {
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Core returned invalid user data'
        }
      };
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        tenant_id: data.user.tenant_id,
        role: data.user.role || 'user',
        org_id: data.user.org_id,
        name: data.user.name
      }
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        error: {
          code: 'CORE_UNAVAILABLE',
          message: 'Ticket validation timeout'
        }
      };
    }

    return {
      error: {
        code: 'CORE_UNAVAILABLE',
        message: `Failed to reach Core service: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    };
  }
}

/**
 * Extract ticket from request (URL param or header)
 */
export function extractTicket(request: Request): string | null {
  // Try URL parameter first (from redirect)
  try {
    const url = new URL(request.url);
    const ticketParam = url.searchParams.get('ticket');
    if (ticketParam) return ticketParam;
  } catch {
    // URL parsing failed, continue to headers
  }

  // Try custom header
  const headerTicket = request.headers.get('X-SSO-Ticket');
  if (headerTicket) return headerTicket;

  return null;
}
