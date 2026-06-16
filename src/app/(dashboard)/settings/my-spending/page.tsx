'use client';

import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { MySpendCard } from '@/components/spend/MySpendCard';

export default function MySpendingPage() {
  return (
    <AppShell>
      <PageHeader
        title="My Spending"
        description="What you've spent, what's left on your budget, and your per-order approval limit."
      />
      <div className="max-w-2xl">
        <MySpendCard />
      </div>
    </AppShell>
  );
}
