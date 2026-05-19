'use client';

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', label: 'Draft' },
  submitted: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Submitted' },
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Confirmed' },
  processing: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500', label: 'Processing' },
  partially_shipped: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500', label: 'Partially Shipped' },
  shipped: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500', label: 'Shipped' },
  partially_received: { bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500', label: 'Partially Received' },
  received: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500', label: 'Received' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Cancelled' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Failed' },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
