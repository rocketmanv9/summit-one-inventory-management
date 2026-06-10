'use client';

import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { Bot } from 'lucide-react';

export default function TestPage() {
  return (
    <AppShell>
      <PageHeader
        title="Tenant Settings"
        description="Configure purchase order numbering and approval rules"
      />

      <SettingsNav />

      <div className="max-w-2xl">
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-md">
              <Bot className="w-6 h-6 text-teal-600" />
            </div>
            <h3 className="text-lg font-semibold">About This Assistant</h3>
          </div>

          <p className="text-gray-700 leading-relaxed">
            I&apos;m the <strong>Summit One Inventory</strong> bug-fix assistant — an AI agent
            embedded in this application to help maintain and improve the codebase.
          </p>

          <p className="text-gray-700 leading-relaxed">
            When you report a bug or request a change, I read the project rules, locate the
            relevant code, make the smallest correct fix, verify it passes tests, then commit
            and push directly to the <code className="bg-gray-100 px-1 rounded text-sm">stage</code> branch.
            I&apos;ll always tell you exactly what changed, which files were touched, and the
            commit SHA so nothing is a mystery.
          </p>

          <p className="text-gray-700 leading-relaxed">
            I stay within safe boundaries: I never touch <code className="bg-gray-100 px-1 rounded text-sm">main</code> or{' '}
            <code className="bg-gray-100 px-1 rounded text-sm">prod</code>, never force-push, and never
            edit credentials or secrets. If a change feels large or risky, I&apos;ll commit it
            locally and ask you to review before it goes anywhere.
          </p>

          <div className="pt-2 border-t text-sm text-gray-500">
            This tab is just here to say hello. You can reach me any time via the <strong>Assistant ↗</strong> link in the top-right of this nav.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
