'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, parseJwtPayload } from '@/lib/auth-token';

export type ClientSession = {
  userId: string;
  email: string;
  tenantId: string | null;
  role: string;
  name: string;
  isDeveloper: boolean;
};

/**
 * Lightweight client-side session hook.
 * Parses the JWT to extract user metadata — no extra network call.
 */
export function useSession() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const token = await getAuthToken();
        if (!token || !mounted) {
          setLoading(false);
          return;
        }

        const payload = parseJwtPayload(token);
        const appMeta = payload.app_metadata || {};
        const userMeta = payload.user_metadata || {};

        setSession({
          userId: payload.sub || '',
          email: payload.email || userMeta.email || '',
          tenantId: appMeta.tenant_id || null,
          role: appMeta.role || 'authenticated',
          name: userMeta.full_name || userMeta.name || '',
          isDeveloper: appMeta.is_developer === true,
        });
      } catch {
        // Token fetch failed — session stays null
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  return { session, loading };
}
