import { redirect } from 'next/navigation';

// Folded into the reworked buying-access surface (item 03, snap-and-buy sprint,
// 2026-08-13): this list editor and the matrix page were two overlapping editors
// over the same tables. One editor now — the group-first workflow at
// /inventory/buying-access (cards + setup wizard + access grid). The URL stays
// alive as a redirect so old links and muscle memory keep working.
export default function BuyableGroupsRedirect() {
  redirect('/inventory/buying-access');
}
