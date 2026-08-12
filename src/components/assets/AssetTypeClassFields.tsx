'use client';

import { useGVTerms, assetKindToTypeDomain } from '@/hooks/useGVTerms';
import { useEquipmentClasses } from '@/hooks/useEquipmentClasses';

const TYPE_LABELS: Record<string, string> = {
  vehicle: 'Vehicle Type',
  equipment: 'Equipment Type',
  tool: 'Tool Type',
};

/**
 * GV-backed Type (+ equipment-only Class) selectors for an asset.
 *
 * The Type dropdown pulls from the GV term domain matching `assetKind`
 * (vehicle_type / equipment_type / tool_type). The Class dropdown pulls from
 * the GV `equipment_classes` catalog and only shows for equipment. Both render
 * nothing for kinds with no GV taxonomy (blank / "other").
 */
export function AssetTypeClassFields({
  assetKind,
  typeTermId,
  classId,
  onTypeChange,
  onClassChange,
  disabled,
}: {
  assetKind: string;
  typeTermId: string;
  classId: string;
  onTypeChange: (value: string) => void;
  onClassChange: (value: string) => void;
  disabled?: boolean;
}) {
  const domain = assetKindToTypeDomain(assetKind);
  const { terms, loading: typesLoading } = useGVTerms(domain);
  const { classes, loading: classesLoading } = useEquipmentClasses();

  if (!domain) return null;

  const inputClass =
    'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50';

  return (
    <>
      <div>
        <label className="block text-sm font-medium mb-1">{TYPE_LABELS[assetKind] || 'Type'}</label>
        <select
          value={typeTermId}
          onChange={(e) => onTypeChange(e.target.value)}
          className={inputClass}
          disabled={disabled || typesLoading}
        >
          <option value="">{typesLoading ? 'Loading…' : 'Select type…'}</option>
          {terms.map((t) => (
            <option key={t.term_id} value={t.term_id}>{t.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">Classification synced from Global Values</p>
      </div>

      {assetKind === 'equipment' && (
        <div>
          <label className="block text-sm font-medium mb-1">Equipment Class</label>
          <select
            value={classId}
            onChange={(e) => onClassChange(e.target.value)}
            className={inputClass}
            disabled={disabled || classesLoading}
          >
            <option value="">{classesLoading ? 'Loading…' : 'Select class…'}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">Equipment taxonomy from Global Values</p>
        </div>
      )}
    </>
  );
}
