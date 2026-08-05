import { ActiveLocationProvider } from '@/lib/active-location';

export const dynamic = 'force-dynamic';

// The active-location context lives here, above every dashboard page, because
// pages call useActiveLocation() in the component that *renders* AppShell — i.e.
// above AppShell's own provider tree. Hoisting it to the layout means both the
// page bodies and everything inside AppShell (the top-nav picker) share one
// context and one localStorage-backed selection.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ActiveLocationProvider>{children}</ActiveLocationProvider>;
}
