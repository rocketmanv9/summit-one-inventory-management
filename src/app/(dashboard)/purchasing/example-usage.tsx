/**
 * Example: Purchase Order Management Page
 * 
 * Demonstrates how to use the CreatePOModal in a real page.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, FileText, Package, Truck } from 'lucide-react';
import { CreatePOModal } from '@/components/modals/CreatePOModal';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Example: Pre-fill from different contexts
  const [presetContext, setPresetContext] = useState<{
    vendorId?: string;
    jobId?: string;
    items?: Array<{ catalog_item_id?: string; item_description?: string; qty_ordered: number }>;
  }>({});
  
  const handleCreatePO = () => {
    setPresetContext({});
    setShowCreateModal(true);
  };
  
  const handleCreatePOFromAlert = () => {
    // Example: Create PO from low stock alert
    setPresetContext({
      vendorId: 'vendor-uuid-here',
      items: [
        {
          catalog_item_id: 'item-uuid-here',
          qty_ordered: 500
        }
      ]
    });
    setShowCreateModal(true);
  };
  
  const handleCreatePOForJob = () => {
    // Example: Create PO from job material needs
    setPresetContext({
      jobId: 'job-uuid-here',
      items: [
        {
          item_description: 'Hot Mix Asphalt',
          qty_ordered: 200
        }
      ]
    });
    setShowCreateModal(true);
  };
  
  const handlePOCreated = (poId: string, poNumber: string) => {
    toast.success(`Purchase Order ${poNumber} created successfully!`, {
      description: 'PO is in draft status. Review and send to vendor.',
      action: {
        label: 'View PO',
        onClick: () => router.push(`/purchasing/orders/${poId}`)
      }
    });
  };
  
  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Purchase Orders</h1>
          <p className="text-muted-foreground mt-1">
            Manage purchase orders and vendor procurement
          </p>
        </div>
        
        <Button onClick={handleCreatePO} size="lg">
          <Plus className="h-4 w-4 mr-2" />
          Create Purchase Order
        </Button>
      </div>
      
      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4">
        <Button
          variant="outline"
          className="h-24 flex flex-col items-center justify-center gap-2"
          onClick={handleCreatePO}
        >
          <FileText className="h-6 w-6" />
          <span>New PO</span>
        </Button>
        
        <Button
          variant="outline"
          className="h-24 flex flex-col items-center justify-center gap-2"
          onClick={handleCreatePOFromAlert}
        >
          <Package className="h-6 w-6" />
          <span>PO from Alert</span>
          <span className="text-xs text-muted-foreground">Low Stock</span>
        </Button>
        
        <Button
          variant="outline"
          className="h-24 flex flex-col items-center justify-center gap-2"
          onClick={handleCreatePOForJob}
        >
          <Truck className="h-6 w-6" />
          <span>PO for Job</span>
          <span className="text-xs text-muted-foreground">Material Needs</span>
        </Button>
      </div>
      
      {/* PO List would go here */}
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No purchase orders yet.</p>
        <p className="text-sm mt-2">Click "Create Purchase Order" to get started.</p>
      </div>
      
      {/* Create PO Modal */}
      <CreatePOModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setPresetContext({});
        }}
        onSuccess={handlePOCreated}
        presetVendorId={presetContext.vendorId}
        presetJobId={presetContext.jobId}
        presetItems={presetContext.items}
      />
    </div>
  );
}

/**
 * Example: Usage from other components
 */

// 1. From Low Stock Widget
export function LowStockWidget() {
  const [showPOModal, setShowPOModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  
  // Example: Assume we have an item from somewhere
  const exampleItem = { id: '123', name: 'Example Item', qty: 10 };
  
  return (
    <>
      <Button
        onClick={() => {
          setSelectedItem(exampleItem);
          setShowPOModal(true);
        }}
      >
        Create PO
      </Button>
      
      <CreatePOModal
        open={showPOModal}
        onClose={() => setShowPOModal(false)}
        presetVendorId={selectedItem?.preferred_vendor_id}
        presetItems={selectedItem ? [{
          catalog_item_id: selectedItem.id,
          qty_ordered: selectedItem.reorder_qty
        }] : []}
      />
    </>
  );
}

// 2. From Job Material Planning
export function JobMaterialsTab({ jobId }: { jobId: string }) {
  const [showPOModal, setShowPOModal] = useState(false);
  const [materials, setMaterials] = useState<any[]>([]);
  
  return (
    <>
      <Button onClick={() => setShowPOModal(true)}>
        Order Materials
      </Button>
      
      <CreatePOModal
        open={showPOModal}
        onClose={() => setShowPOModal(false)}
        presetJobId={jobId}
        presetItems={materials.map(m => ({
          catalog_item_id: m.catalog_item_id,
          qty_ordered: m.qty_needed
        }))}
      />
    </>
  );
}

// 3. From Vendor Detail Page
export function VendorDetailPage({ vendorId }: { vendorId: string }) {
  const [showPOModal, setShowPOModal] = useState(false);
  
  return (
    <>
      <Button onClick={() => setShowPOModal(true)}>
        Create PO for this Vendor
      </Button>
      
      <CreatePOModal
        open={showPOModal}
        onClose={() => setShowPOModal(false)}
        presetVendorId={vendorId}
      />
    </>
  );
}
