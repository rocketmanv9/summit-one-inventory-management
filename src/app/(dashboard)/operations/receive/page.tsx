import { AppShell } from '@/components/layout/AppShell';

export default function ReceivePage() {
  return (
    <AppShell>
      <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Receive Stock</h1>
        <p className="text-muted-foreground">
          Log incoming inventory from suppliers or transfers
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <p className="text-center text-muted-foreground">
          Receive stock form coming soon...
        </p>
      </div>
    </div>
    </AppShell>
  );
}
