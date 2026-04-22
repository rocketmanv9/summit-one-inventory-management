'use client';

type StatusType =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'in_transit'
  | 'received'
  | 'partially_received'
  | 'active'
  | 'inactive'
  | 'available'
  | 'assigned'
  | 'maintenance'
  | 'retired'
  | 'soft'
  | 'hard'
  | 'kit'
  | 'scheduled'
  | 'published'
  | 'closed';

const statusConfig: Record<StatusType, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-800', dot: 'bg-gray-500' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-800', dot: 'bg-gray-400' },
  submitted: { bg: 'bg-purple-100', text: 'text-purple-800', dot: 'bg-purple-500' },
  approved: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  in_transit: { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500' },
  received: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  partially_received: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  active: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  inactive: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  available: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  assigned: { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500' },
  maintenance: { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  retired: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  soft: { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-400' },
  hard: { bg: 'bg-purple-100', text: 'text-purple-800', dot: 'bg-purple-500' },
  kit: { bg: 'bg-indigo-100', text: 'text-indigo-800', dot: 'bg-indigo-500' },
  scheduled: { bg: 'bg-cyan-100', text: 'text-cyan-800', dot: 'bg-cyan-500' },
  published: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  closed: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
};

interface StatusChipProps {
  status: string | null | undefined;
  showDot?: boolean;
  size?: 'sm' | 'md';
}

export function StatusChip({ status, showDot = true, size = 'sm' }: StatusChipProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full font-medium bg-gray-100 text-gray-800 px-2 py-0.5 text-xs">
        Unknown
      </span>
    );
  }
  
  const normalizedStatus = status.toLowerCase().replace(/ /g, '_') as StatusType;
  const config = statusConfig[normalizedStatus] || { bg: 'bg-gray-100', text: 'text-gray-800', dot: 'bg-gray-500' };

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses}`}
    >
      {showDot && (
        <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      )}
      {status.replace(/_/g, ' ')}
    </span>
  );
}
