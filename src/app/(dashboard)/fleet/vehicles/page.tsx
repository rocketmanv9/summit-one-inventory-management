'use client';

import { AssetKindView } from '@/components/inventory/AssetKindView';

export default function VehiclesPage() {
  return (
    <AssetKindView
      kind="vehicle"
      labelPlural="Vehicles"
      labelSingular="Vehicle"
      catalogEndpoint="/api/gv/vehicles/catalog"
      adoptEndpoint="/api/gv/vehicles/adopt"
      adoptBodyKey="catalogVehicleIds"
    />
  );
}
