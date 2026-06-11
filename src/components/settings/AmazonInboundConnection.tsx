'use client';

/**
 * Amazon Business inbound connection panel.
 *
 * Generates this tenant's unique Order-Confirmation / Ship-Notification
 * credentials and shows the exact webhook URLs + values to paste into
 * Amazon Business → Connections. This is what makes order status + carrier
 * tracking flow back into Summit One.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Copy, Check, RefreshCw, Truck, ShieldCheck } from 'lucide-react';

const API = '/api/settings/integrations/amazon-business/inbound-connection';

interface InboundData {
  provider_exists: boolean;
  configured: boolean;
  username: string;
  password: string;
  order_confirmation_url: string;
  ship_notice_url: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 truncate px-3 py-2 border rounded-md bg-muted/40 font-mono text-xs" title={value}>
          {value || '—'}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!value}
          className="px-2.5 border rounded-md hover:bg-gray-50 disabled:opacity-40 flex items-center"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function AmazonInboundConnection() {
  const [data, setData] = useState<InboundData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API);
      const json = await res.json();
      if (res.ok) setData(json.data);
      else setError(json?.error?.message || 'Failed to load inbound connection.');
    } catch {
      setError('Failed to load inbound connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to generate credentials.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate credentials.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="rounded-lg border bg-card p-6 animate-pulse h-40" />;
  }

  return (
    <div className="rounded-lg border bg-card p-6 space-y-5">
      <div className="flex items-start gap-2">
        <Truck className="h-5 w-5 text-blue-600 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Order Status &amp; Shipment Tracking (Inbound)</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Let Amazon send order confirmations and carrier tracking back into Summit One. Generate
            your credentials below, then add two connections in Amazon Business using the URLs and
            credentials shown.
          </p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}

      {!data?.provider_exists ? (
        <p className="text-sm text-muted-foreground italic">
          Connect Amazon Business above first, then come back here to set up inbound updates.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                data.configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              <ShieldCheck className="h-3 w-3" />
              {data.configured ? 'Credentials generated' : 'Not set up yet'}
            </span>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="ml-auto px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {data.configured ? 'Regenerate password' : 'Generate credentials'}
            </button>
          </div>

          {data.configured && (
            <div className="grid grid-cols-1 gap-3">
              <CopyField label="Username" value={data.username} />
              <CopyField label="Password" value={data.password} />
              <CopyField label="Order Confirmation URL" value={data.order_confirmation_url} />
              <CopyField label="Ship Notification URL" value={data.ship_notice_url} />
            </div>
          )}

          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-medium mb-2">What to do in Amazon Business</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-blue-800">
              <li>
                Go to <span className="font-medium">Amazon Business → Integrations → Manage Connections</span> (cXML / Punchout).
              </li>
              <li>
                Add an <span className="font-medium">Order Confirmation</span> connection → paste the
                <span className="font-medium"> Order Confirmation URL</span> → set Authentication to
                <span className="font-medium"> Basic</span> → enter the Username + Password above.
              </li>
              <li>
                Add a <span className="font-medium">Ship Notification (ASN)</span> connection → paste the
                <span className="font-medium"> Ship Notification URL</span> → use the
                <span className="font-medium"> same Username + Password</span>.
              </li>
              <li>Save in Amazon. Your next order will confirm and then show carrier tracking on the PO automatically.</li>
            </ol>
            <p className="text-[11px] text-blue-700 mt-2">
              Regenerating the password invalidates the old one — update both Amazon connections if you do.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
