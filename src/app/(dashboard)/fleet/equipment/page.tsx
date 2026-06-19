'use client';

import { AssetKindView } from '@/components/inventory/AssetKindView';

export default function EquipmentPage() {
  return (
    <AssetKindView
      kind="equipment"
      labelPlural="Equipment"
      labelSingular="Equipment"
      catalogEndpoint="/api/gv/equipment/catalog"
      adoptEndpoint="/api/gv/equipment/adopt"
      adoptBodyKey="catalogEquipmentIds"
    />
  );
}
