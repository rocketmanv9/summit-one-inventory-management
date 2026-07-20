'use client';

import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export interface BarcodeLabelItem {
  code: string;
  label: string;
  /**
   * What kind of label this is:
   *  - 'stock'      — identical catalog labels; every printed label reads the
   *                   same (item barcode/SKU). Quantity comes from Copies.
   *  - 'individual' — one-of-a-kind label for a single unit (asset tag /
   *                   serial); no two labels match.
   * Untagged items print as before with no kind messaging.
   */
  kind?: 'stock' | 'individual';
}

type KindFilter = 'all' | 'stock' | 'individual';

const KIND_META = {
  stock: {
    title: 'Stock labels',
    blurb: 'Every label reads the same — the item barcode/SKU. Use Copies for how many you need.',
    badge: 'STOCK',
    className: 'bg-blue-50 border-blue-200 text-blue-800',
    chip: 'bg-blue-100 text-blue-700',
  },
  individual: {
    title: 'Individual labels',
    blurb: 'Each label is unique to one unit (asset tag / serial). One label per unit.',
    badge: 'UNIT',
    className: 'bg-purple-50 border-purple-200 text-purple-800',
    chip: 'bg-purple-100 text-purple-700',
  },
} as const;

type LabelFormat = 'both' | 'barcode' | 'qr';
type OutputMode = 'sheet' | 'ptouch';
type TapeWidth = 24 | 18 | 12;

interface BarcodeLabelDialogProps {
  items: BarcodeLabelItem[];
  entityType: 'asset' | 'tool' | 'item';
  onClose: () => void;
  /** Pre-print caution (e.g. "already tagged and located") — amber, screen-only. */
  warning?: string;
}

// Brother P-touch D610BT prints TZe continuous tape at 180dpi.
// The printable band is narrower than the physical tape.
const TAPE_PRINT_HEIGHT_MM: Record<TapeWidth, number> = {
  24: 18,
  18: 15.8,
  12: 9,
};

// Label length along the tape, per format. One @page rule applies to the
// whole print job, so every label in a batch shares the same length.
const PTOUCH_LENGTH_MM: Record<LabelFormat, number> = {
  qr: 52,
  barcode: 72,
  both: 90,
};

const OUTPUT_STORAGE_KEY = 'label-output-mode';

export function BarcodeLabelDialog({ items, entityType, onClose, warning }: BarcodeLabelDialogProps) {
  const [format, setFormat] = useState<LabelFormat>('both');
  const [copies, setCopies] = useState(1);
  const [output, setOutput] = useState<OutputMode>('sheet');
  const [tapeWidth, setTapeWidth] = useState<TapeWidth>(24);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  useEffect(() => {
    const saved = localStorage.getItem(OUTPUT_STORAGE_KEY);
    if (saved === 'ptouch' || saved === 'sheet') {
      setOutput(saved);
    }
  }, []);

  const selectOutput = (mode: OutputMode) => {
    setOutput(mode);
    localStorage.setItem(OUTPUT_STORAGE_KEY, mode);
  };

  // Stock vs individual: when the batch mixes both kinds, a switcher picks
  // which set prints; a single-kind batch gets an explicit banner instead so
  // it's never ambiguous whether these labels all read the same.
  const stockCount = items.filter((i) => i.kind === 'stock').length;
  const individualCount = items.filter((i) => i.kind === 'individual').length;
  const mixed = stockCount > 0 && individualCount > 0;
  const soleKind: 'stock' | 'individual' | null = mixed
    ? null
    : stockCount > 0
      ? 'stock'
      : individualCount > 0
        ? 'individual'
        : null;
  const activeItems = mixed && kindFilter !== 'all' ? items.filter((i) => i.kind === kindFilter) : items;

  // Build the final list of labels (items × copies)
  const labels: BarcodeLabelItem[] = [];
  for (const item of activeItems) {
    for (let i = 0; i < copies; i++) {
      labels.push(item);
    }
  }

  const handlePrint = () => {
    window.print();
  };

  const tapeLengthMm = PTOUCH_LENGTH_MM[format];

  return (
    <div className="barcode-print-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* Always-on: the modal is a fixed, scrollable (max-h/overflow) box, which
          clips printing to a single screen — so only one label came out. During
          print, neutralize the overlay + scroll container so every label flows
          onto its own page. */}
      <style>{`
        @media print {
          /* Print ONLY the labels: hide the whole app, reveal the overlay. */
          body * { visibility: hidden !important; }
          .barcode-print-overlay, .barcode-print-overlay * { visibility: visible !important; }
          /* Kill the fixed/flex-centered overlay so labels start at the top and
             the page grows to fit ALL of them (not one centered screen). */
          .barcode-print-overlay {
            visibility: visible !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            display: block !important;
            align-items: initial !important;
            justify-content: initial !important;
            background: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .barcode-print-modal {
            position: static !important;
            max-width: none !important;
            max-height: none !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
        }
      `}</style>
      {output === 'ptouch' && (
        // Size each label as its own tape-dimensioned page so the P-touch
        // driver feeds and cuts between labels. mm units keep print exact.
        <style>{`
          @media print {
            @page { size: ${tapeLengthMm}mm ${tapeWidth}mm; margin: 0; }
            .barcode-print-area { padding: 0 !important; }
            .ptouch-label { break-after: page; page-break-after: always; }
          }
        `}</style>
      )}
      <div className="barcode-print-modal bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
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

          {warning ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span className="font-semibold">Heads up:</span> {warning}
            </div>
          ) : null}

          {/* Stock vs individual — banner for a single-kind batch, switcher for a mix */}
          {soleKind ? (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${KIND_META[soleKind].className}`}>
              <span className="font-semibold">{KIND_META[soleKind].title}:</span> {KIND_META[soleKind].blurb}
            </div>
          ) : mixed ? (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Printing:</span>
                <div className="flex rounded-lg border overflow-hidden bg-white">
                  {([
                    ['all', `Both (${stockCount + individualCount})`],
                    ['stock', `Stock (${stockCount})`],
                    ['individual', `Individual (${individualCount})`],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setKindFilter(val)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        kindFilter === val
                          ? 'bg-primary text-primary-foreground'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                <span className="font-medium text-blue-700">Stock</span> labels all read the same (item barcode) ·{' '}
                <span className="font-medium text-purple-700">Individual</span> labels are unique to one unit (asset tag)
              </div>
            </div>
          ) : null}

          {/* Options */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Output selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Print to:</span>
              <div className="flex rounded-lg border overflow-hidden">
                {([['sheet', 'Standard Printer'], ['ptouch', 'P-touch Label Maker']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => selectOutput(val)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      output === val
                        ? 'bg-primary text-primary-foreground'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tape width (P-touch only) */}
            {output === 'ptouch' && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Tape:</span>
                <div className="flex rounded-lg border overflow-hidden">
                  {([24, 18, 12] as const).map((mm) => (
                    <button
                      key={mm}
                      onClick={() => setTapeWidth(mm)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        tapeWidth === mm
                          ? 'bg-primary text-primary-foreground'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {mm}mm
                    </button>
                  ))}
                </div>
              </div>
            )}

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

          {output === 'ptouch' && (
            <div className="mt-3 text-xs text-gray-500">
              In the print dialog, choose the <span className="font-medium">Brother PT-D610BT</span> printer
              and make sure the loaded tape matches the {tapeWidth}mm selection.
              {tapeWidth === 12 && format !== 'barcode' && (
                <span className="text-amber-600"> QR codes on 12mm tape print at 9mm — they can be hard to scan; 18mm or 24mm tape is recommended.</span>
              )}
            </div>
          )}
        </div>

        {/* Labels */}
        <div className="p-4 barcode-print-area">
          {output === 'sheet' ? (
            <div className="grid grid-cols-2 gap-2 print:gap-1">
              {labels.map((item, idx) => (
                <BarcodeLabel key={`${item.code}-${idx}`} item={item} entityType={entityType} format={format} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 print:gap-0">
              {labels.map((item, idx) => (
                <PtouchLabel
                  key={`${item.code}-${idx}`}
                  item={item}
                  format={format}
                  tapeWidth={tapeWidth}
                  lengthMm={tapeLengthMm}
                />
              ))}
            </div>
          )}
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
    <div className="relative border rounded p-2 flex flex-col items-center gap-1 overflow-hidden print:border-gray-300 print:p-1.5 print:break-inside-avoid">
      {/* Screen-only kind chip — never printed */}
      {item.kind ? (
        <span
          className={`absolute top-1 right-1 rounded px-1 py-0.5 text-[8px] font-bold tracking-wide print:hidden ${KIND_META[item.kind].chip}`}
        >
          {KIND_META[item.kind].badge}
        </span>
      ) : null}
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

// One tape strip, dimensioned in real mm so the print is 1:1 on the D610BT.
// Content is centered inside the printable band (narrower than the tape).
function PtouchLabel({ item, format, tapeWidth, lengthMm }: {
  item: BarcodeLabelItem;
  format: LabelFormat;
  tapeWidth: TapeWidth;
  lengthMm: number;
}) {
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const showBarcode = format === 'both' || format === 'barcode';
  const showQr = format === 'both' || format === 'qr';
  const printHeightMm = TAPE_PRINT_HEIGHT_MM[tapeWidth];

  useEffect(() => {
    if (showBarcode && barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, item.code, {
          format: 'CODE128',
          // Render at high resolution; CSS scales it into the mm box. The
          // D610BT is 180dpi, so thin modules need a generous source width.
          width: 2,
          height: 60,
          displayValue: false,
          margin: 0,
        });
      } catch {
        if (barcodeSvgRef.current) {
          barcodeSvgRef.current.innerHTML = '';
        }
      }
    }

    if (showQr) {
      QRCode.toDataURL(item.code, {
        width: 360,
        margin: 0,
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => {});
    }
  }, [item.code, showBarcode, showQr]);

  // Tape text scales with the printable band so 12mm tape stays legible.
  const nameFontMm = Math.max(2.2, printHeightMm * 0.18);
  const codeFontMm = Math.max(1.8, printHeightMm * 0.14);
  const barcodeHeightMm = printHeightMm * (format === 'barcode' ? 0.62 : 0.55);

  return (
    <div
      className="ptouch-label border border-dashed border-gray-300 print:border-0 bg-white flex items-center justify-center overflow-hidden"
      style={{ width: `${lengthMm}mm`, height: `${tapeWidth}mm` }}
    >
      <div
        className="flex items-center gap-[1.5mm] overflow-hidden"
        style={{ height: `${printHeightMm}mm`, width: `${lengthMm - 3}mm` }}
      >
        {showQr && qrDataUrl && (
          <img
            src={qrDataUrl}
            alt={`QR: ${item.code}`}
            className="shrink-0"
            style={{ width: `${printHeightMm}mm`, height: `${printHeightMm}mm` }}
          />
        )}

        <div className="flex flex-col justify-center min-w-0 flex-1 overflow-hidden">
          <div
            className="font-semibold leading-tight truncate text-black"
            style={{ fontSize: `${nameFontMm}mm` }}
          >
            {item.label}
          </div>
          <div
            className="font-mono leading-tight truncate text-black"
            style={{ fontSize: `${codeFontMm}mm` }}
          >
            {item.code}
          </div>
          {showBarcode && (
            <svg
              ref={barcodeSvgRef}
              preserveAspectRatio="none"
              style={{ width: '100%', height: `${barcodeHeightMm}mm` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
