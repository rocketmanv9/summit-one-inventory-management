/**
 * Example: Admin-only route
 * DELETE /api/inventory/items/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/lib/auth-middleware';
import { createClient } from '@supabase/supabase-js';

export const DELETE = withRole('admin', async (req, authContext) => {
  const url = new URL(req.url);
  const itemId = url.pathname.split('/').pop();

  if (!itemId) {
    return NextResponse.json(
      { error: 'Item ID required' },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get('authorization')!
        }
      }
    }
  );

  // RLS ensures user can only delete items in their tenant
  // Additional RLS policy ensures only admins can delete
  const { error } = await supabase
    .from('catalog_items')
    .delete()
    .eq('id', itemId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
});
