'use client';

import { AssetKindView } from '@/components/inventory/AssetKindView';

export default function ToolsPage() {
  return (
    <AssetKindView
      kind="tool"
      labelPlural="Tools"
      labelSingular="Tool"
    />
  );
}
