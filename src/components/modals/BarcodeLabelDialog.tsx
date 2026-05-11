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
  entityType: 'asset' | 'tool';
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

function BarcodeLabel({ item, entityType }: { item: BarcodeLabelItem; entityType: 'asset' | 'tool' }) {
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    // Render Code 128 barcode
    if (barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, item.code, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
          margin: 5,
          font: 'monospace',
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
    <div className="border rounded-lg p-4 flex flex-col items-center gap-2 print:border print:rounded print:p-3 print:break-inside-avoid">
      <div className="text-xs text-muted-foreground uppercase tracking-wide print:text-[9px]">
        {entityType === 'asset' ? 'Asset' : 'Tool'}
      </div>
      <div className="text-sm font-medium text-center truncate max-w-full print:text-xs">
        {item.label}
      </div>
      <div className="flex items-center gap-4">
        <svg ref={barcodeSvgRef} className="max-w-[200px]" />
        {qrDataUrl && (
          <img src={qrDataUrl} alt={`QR: ${item.code}`} className="w-[80px] h-[80px] print:w-[60px] print:h-[60px]" />
        )}
      </div>
    </div>
  );
}
