'use client';

import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export interface BarcodeLabelItem {
  code: string;
  label: string;
}

interface BarcodeLabelDialogProps {
  items: BarcodeLabelItem[];
  entityType: 'asset' | 'tool' | 'item';
  onClose: () => void;
}

export function BarcodeLabelDialog({ items, entityType, onClose }: BarcodeLabelDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header - hidden during print */}
        <div className="px-6 py-4 border-b flex items-center justify-between print:hidden">
          <h3 className="text-lg font-semibold">
            {items.length === 1 ? 'Barcode Label' : `Barcode Labels (${items.length})`}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            &#10005;
          </button>
        </div>

        {/* Labels */}
        <div ref={printRef} className="p-6 barcode-print-area">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 print:grid-cols-2 print:gap-4">
            {items.map((item) => (
              <BarcodeLabel key={item.code} item={item} entityType={entityType} />
            ))}
          </div>
        </div>

        {/* Actions - hidden during print */}
        <div className="px-6 py-4 border-t flex gap-3 justify-end print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Print {items.length === 1 ? 'Label' : `${items.length} Labels`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BarcodeLabel({ item, entityType }: { item: BarcodeLabelItem; entityType: 'asset' | 'tool' | 'item' }) {
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    // Render Code 128 barcode
    if (barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, item.code, {
          format: 'CODE128',
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 11,
          margin: 2,
          font: 'monospace',
          textMargin: 2,
        });
      } catch {
        // If code can't be encoded in Code128, show a fallback
        if (barcodeSvgRef.current) {
          barcodeSvgRef.current.innerHTML = '';
        }
      }
    }

    // Render QR code — encode a mobile-friendly URL so phones open the lookup page
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanUrl = `${origin}/m/scan?code=${encodeURIComponent(item.code)}`;
    QRCode.toDataURL(scanUrl, {
      width: 100,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(() => {});
  }, [item.code]);

  return (
    <div className="barcode-label-card border rounded-lg p-3 flex flex-col items-center gap-1.5 overflow-hidden">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide print:text-[8px]">
        {entityType === 'asset' ? 'Asset' : entityType === 'item' ? 'Item' : 'Tool'}
      </div>
      <div className="text-xs font-medium text-center truncate max-w-full print:text-[10px]">
        {item.label}
      </div>
      <div className="flex items-center gap-3 w-full justify-center min-w-0">
        <svg ref={barcodeSvgRef} className="shrink min-w-0 max-w-[180px] h-auto" />
        {qrDataUrl && (
          <img src={qrDataUrl} alt={`QR: ${item.code}`} className="w-[60px] h-[60px] shrink-0 print:w-[50px] print:h-[50px]" />
        )}
      </div>
    </div>
  );
}
