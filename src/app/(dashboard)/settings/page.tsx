import { AppShell } from '@/components/layout/AppShell';

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your inventory system configuration
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <p className="text-center text-muted-foreground">
          Settings coming soon...
        </p>
      </div>
    </div>
    </AppShell>
  );
}
