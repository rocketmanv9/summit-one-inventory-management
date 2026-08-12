'use client';

/**
 * Count Qualifications moved onto the Position Access page (2026-07-29) so
 * people permissions live in one place. This stub keeps old links working.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CountQualificationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/access#count-qualifications');
  }, [router]);
  return null;
}
