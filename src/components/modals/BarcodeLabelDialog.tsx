'use client';

import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export interface BarcodeLabelItem {
  code: string;
  label: string;
}

type LabelFormat = 'both' | 'barcode' | 'qr';

interface BarcodeLabelDialogProps {
  items: BarcodeLabelItem[];
  entityType: 'asset' | 'tool' | 'item';
  onClose: () => void;
}

export function BarcodeLabelDialog({ items, entityType, onClose }: BarcodeLabelDialogProps) {
  const [format, setFormat] = useState<LabelFormat>('both');
  const [copies, setCopies] = useState(1);

  // Build the final list of labels (items × copies)
  const labels: BarcodeLabelItem[] = [];
  for (const item of items) {
    for (let i = 0; i < copies; i++) {
      labels.push(item);
    }
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header - hidden during print */}
        <div className="px-6 py-4 border-b print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              Print Labels
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              &#10005;
            </button>
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Format selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Format:</span>
              <div className="flex rounded-lg border overflow-hidden">
                {([['both', 'Both'], ['barcode', 'Barcode'], ['qr', 'QR Code']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFormat(val)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      format === val
                        ? 'bg-primary text-primary-foreground'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Copies */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Copies:</span>
              <input
                type="number"
                min={1}
                max={50}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="w-16 px-2 py-1.5 text-sm border rounded-lg text-center"
              />
            </div>

            <span className="text-xs text-gray-400">
              {labels.length} label{labels.length !== 1 ? 's' : ''} total
            </span>
          </div>
        </div>

        {/* Labels — 2 columns, compact for printing */}
        <div className="p-4 barcode-print-area">
          <div className="grid grid-cols-2 gap-2 print:gap-1">
            {labels.map((item, idx) => (
              <BarcodeLabel key={`${item.code}-${idx}`} item={item} entityType={entityType} format={format} />
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
            Print {labels.length} Label{labels.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function BarcodeLabel({ item, entityType, format }: {
  item: BarcodeLabelItem;
  entityType: 'asset' | 'tool' | 'item';
  format: LabelFormat;
}) {
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const showBarcode = format === 'both' || format === 'barcode';
  const showQr = format === 'both' || format === 'qr';

  useEffect(() => {
    // Render Code 128 barcode
    if (showBarcode && barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, item.code, {
          format: 'CODE128',
          width: format === 'barcode' ? 2 : 1.5,
          height: format === 'barcode' ? 50 : 40,
          displayValue: true,
          fontSize: 11,
          margin: 2,
          font: 'monospace',
          textMargin: 2,
        });
      } catch {
        if (barcodeSvgRef.current) {
          barcodeSvgRef.current.innerHTML = '';
        }
      }
    }

    // Render QR code
    if (showQr) {
      const size = format === 'qr' ? 140 : 100;
      QRCode.toDataURL(item.code, {
        width: size,
        margin: 1,
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => {});
    }
  }, [item.code, format, showBarcode, showQr]);

  const entityLabel = entityType === 'asset' ? 'Asset' : entityType === 'item' ? 'Item' : 'Tool';

  return (
    <div className="border rounded p-2 flex flex-col items-center gap-1 overflow-hidden print:border-gray-300 print:p-1.5 print:break-inside-avoid">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
        {entityLabel}
      </div>
      <div className="text-[11px] font-medium text-center truncate max-w-full leading-tight">
        {item.label}
      </div>

      {format === 'both' && (
        <div className="flex items-center gap-2 w-full justify-center min-w-0">
          <svg ref={barcodeSvgRef} className="shrink min-w-0 max-w-[160px] h-auto" />
          {qrDataUrl && (
            <img src={qrDataUrl} alt={`QR: ${item.code}`} className="w-[50px] h-[50px] shrink-0" />
          )}
        </div>
      )}

      {format === 'barcode' && (
        <div className="w-full flex justify-center">
          <svg ref={barcodeSvgRef} className="max-w-[220px] h-auto" />
        </div>
      )}

      {format === 'qr' && qrDataUrl && (
        <div className="flex flex-col items-center gap-0.5">
          <img src={qrDataUrl} alt={`QR: ${item.code}`} className="w-[80px] h-[80px]" />
          <div className="text-[10px] font-mono text-gray-500">{item.code}</div>
        </div>
      )}
    </div>
  );
}
