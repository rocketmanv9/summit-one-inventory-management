'use client';

import { AppShell } from '@/components/layout/AppShell';
import { AvatarStateProvider } from '@/lib/ai/avatar-store';
import { AvatarChatPage } from '@/components/ai/AvatarChatPage';

export default function AIWorkspacePage() {
  return (
    <AppShell>
      <AvatarStateProvider>
        <AvatarChatPage />
      </AvatarStateProvider>
    </AppShell>
  );
}
