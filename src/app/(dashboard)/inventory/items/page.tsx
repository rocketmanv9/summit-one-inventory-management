import { redirect } from 'next/navigation';

// The catalog list merged into the single Inventory page (/inventory/stock).
// Item detail/edit lives at /inventory/items/[id]; the full creation wizard
// stays at /inventory/items/new.
export default function ItemsIndexRedirect() {
  redirect('/inventory/stock');
}
