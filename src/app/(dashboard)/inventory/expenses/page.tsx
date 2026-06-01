'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite } from '@/lib/api-client';

interface AccountingExpense {
  id: string;
  vendor_id?: string;
  po_id?: string;
  expense_date: string;
  amount: number;
  currency: string;
  status: string;
  invoice_number?: string;
  description?: string;
  matched_at?: string;
  created_at: string;
  vendors?: { id: string; name: string; code?: string };
  purchase_orders?: { id: string; po_number: string; status: string };
}

export default function AccountingExpensesPage() {
  const [expenses, setExpenses] = useState<AccountingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'posted' });
  const [selectedExpense, setSelectedExpense] = useState<AccountingExpense | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchingPOs, setMatchingPOs] = useState<any[]>([]);

  useEffect(() => {
    fetchExpenses();
  }, [filters]);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.vendor_id) params.set('vendor_id', filters.vendor_id);

      const res = await fetch(`/api/inventory/accounting/expenses?${params}`);
      const { data } = await res.json();
      setExpenses(data || []);
    } catch (error) {
      console.error('Error fetching expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMatch = async (expenseId: string, poId: string) => {
    try {
      const res = await apiWrite(`/api/inventory/accounting/expenses/${expenseId}/match`, {
        method: 'POST',
        body: { po_id: poId }
      });

      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error?.message || result.error || 'Failed to match expense'}`);
        return;
      }

      alert('Expense matched successfully!');
      setShowMatchModal(false);
      fetchExpenses();
    } catch (error) {
      console.error('Error matching expense:', error);
      alert('Failed to match expense. Please try again.');
    }
  };

  const handleIgnore = async (expenseId: string) => {
    if (!confirm('Mark this expense as ignored? It will not appear in unmatched reports.')) {
      return;
    }

    try {
      const res = await apiWrite(`/api/inventory/accounting/expenses/${expenseId}`, {
        method: 'PATCH',
        body: { status: 'ignored' }
      });

      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error?.message || result.error || 'Failed to update expense'}`);
        return;
      }

      alert('Expense marked as ignored.');
      fetchExpenses();
    } catch (error) {
      console.error('Error updating expense:', error);
      alert('Failed to update expense. Please try again.');
    }
  };

  const handleDispute = async (expenseId: string) => {
    const reason = prompt('Enter dispute reason:');
    if (!reason) return;

    try {
      const res = await apiWrite(`/api/inventory/accounting/expenses/${expenseId}`, {
        method: 'PATCH',
        body: { status: 'disputed', dispute_reason: reason }
      });

      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error?.message || result.error || 'Failed to dispute expense'}`);
        return;
      }

      alert('Expense marked as disputed.');
      fetchExpenses();
    } catch (error) {
      console.error('Error disputing expense:', error);
      alert('Failed to dispute expense. Please try again.');
    }
  };

  const openMatchDialog = async (expense: AccountingExpense) => {
    setSelectedExpense(expense);
    
    // Fetch potential matching POs for this vendor
    if (expense.vendor_id) {
      try {
        const params = new URLSearchParams({
          vendor_id: expense.vendor_id,
          status: 'fully_received,partially_received'
        });
        const res = await fetch(`/api/inventory/purchasing?${params}`);
        const { data } = await res.json();
        setMatchingPOs(data || []);
      } catch (error) {
        console.error('Error fetching POs:', error);
      }
    }
    
    setShowMatchModal(true);
  };

  const columns = [
    {
      key: 'expense_date',
      header: 'Date',
      sortable: true,
      render: (row: AccountingExpense) => new Date(row.expense_date).toLocaleDateString(),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortable: true,
      render: (row: AccountingExpense) => (
        <div>
          <div className="font-medium">{row.vendors?.name || '-'}</div>
          {row.vendors?.code && (
            <div className="text-xs text-muted-foreground font-mono">{row.vendors.code}</div>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: AccountingExpense) => (
        <span className="font-semibold">
          ${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'invoice_number',
      header: 'Invoice #',
      render: (row: AccountingExpense) => (
        <span className="font-mono text-sm">{row.invoice_number || '-'}</span>
      ),
    },
    {
      key: 'po',
      header: 'Matched PO',
      render: (row: AccountingExpense) => (
        row.purchase_orders ? (
          <div>
            <div className="font-mono text-sm">{row.purchase_orders.po_number}</div>
            {row.matched_at && (
              <div className="text-xs text-muted-foreground">
                {new Date(row.matched_at).toLocaleDateString()}
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: AccountingExpense) => <StatusChip status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: AccountingExpense) => {
        const isPosted = row.status === 'posted';
        const isDisputed = row.status === 'disputed';
        const isMatched = row.status === 'matched';

        return (
          <div className="flex flex-col gap-1 min-w-[100px]">
            {isPosted && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openMatchDialog(row);
                  }}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Match to PO
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDispute(row.id);
                  }}
                  className="px-3 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded"
                >
                  Dispute
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleIgnore(row.id);
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                >
                  Ignore
                </button>
              </>
            )}
            {isDisputed && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openMatchDialog(row);
                  }}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Match to PO
                </button>
                <span className="text-xs text-yellow-600">Needs resolution</span>
              </>
            )}
            {isMatched && (
              <span className="text-xs text-green-600">Matched</span>
            )}
          </div>
        );
      },
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: '', label: 'All' },
        { value: 'posted', label: 'Unmatched' },
        { value: 'matched', label: 'Matched' },
        { value: 'disputed', label: 'Disputed' },
        { value: 'ignored', label: 'Ignored' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="p-6">
        <PageHeader
          title="Accounting Expenses"
          description="Match expenses to purchase orders"
        />

        <div className="mt-6">
          <FilterBar
            filters={filterConfig}
            values={filters}
            onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            data={expenses}
            loading={loading}
            rowKey={(row) => row.id}
            onRowClick={(row) => console.log('View expense details:', row)}
          />
        </div>

        {/* Match Modal */}
        {showMatchModal && selectedExpense && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Match Expense to Purchase Order</h3>
              
              <div className="mb-4 p-4 bg-gray-50 rounded">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Vendor:</span>{' '}
                    <span className="font-medium">{selectedExpense.vendors?.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{' '}
                    <span className="font-mono font-semibold">
                      ${selectedExpense.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>{' '}
                    {new Date(selectedExpense.expense_date).toLocaleDateString()}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Invoice:</span>{' '}
                    <span className="font-mono">{selectedExpense.invoice_number || 'N/A'}</span>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <h4 className="font-medium mb-2">Select Purchase Order:</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {matchingPOs.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No matching POs found for this vendor.</p>
                  ) : (
                    matchingPOs.map(po => (
                      <button
                        key={po.id}
                        onClick={() => handleMatch(selectedExpense.id, po.id)}
                        className="w-full p-3 text-left border rounded hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-mono font-medium">{po.po_number}</div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(po.order_date).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono">
                              ${po.purchase_order_lines?.reduce((sum: number, line: any) => 
                                sum + (line.qty_ordered * line.unit_cost), 0
                              ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                            <StatusChip status={po.status} />
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowMatchModal(false)}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
