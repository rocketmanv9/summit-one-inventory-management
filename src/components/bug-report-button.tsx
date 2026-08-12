'use client';

/**
 * Bug reporter — IDENTICAL component in ops / fleet / inventory (only the
 * SERVICE const differs per repo). A floating 🐛 opens a tiny form; the
 * report records who (session), where (page URL), and what (description +
 * severity) via the service's own POST /api/bugs. Reports federate onto the
 * Operations /bugs board, where they become Claude-ready prompts.
 */
import { useState } from 'react';

const SERVICE = 'inventory';

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('normal');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');

  async function submit() {
    if (!description.trim()) return;
    setState('busy');
    const res = await fetch('/api/bugs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        service: SERVICE,
        description: description.trim(),
        severity,
        page_url: globalThis.location?.href ?? null,
      }),
    });
    setState(res.ok ? 'done' : 'err');
    if (res.ok) {
      setDescription('');
      setTimeout(() => { setOpen(false); setState('idle'); }, 1200);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title="Report a bug"
        className="fixed bottom-4 left-4 z-[60] flex h-10 w-10 items-center justify-center rounded-full border bg-card text-lg shadow-lg transition-transform hover:scale-110"
      >
        🐛
      </button>
      {open && (
        <div className="fixed bottom-16 left-4 z-[60] w-80 rounded-xl border bg-card p-3 shadow-2xl">
          <p className="mb-1.5 text-sm font-semibold text-card-foreground">Report a bug</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? What did you expect?"
            rows={4}
            autoFocus
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            {(['annoying', 'normal', 'blocking'] as const).map((s) => (
              <button key={s} onClick={() => setSeverity(s)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${severity === s ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
                {s}
              </button>
            ))}
            <button
              onClick={() => void submit()}
              disabled={state === 'busy' || !description.trim()}
              className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {state === 'busy' ? 'Sending…' : state === 'done' ? '✓ Sent' : state === 'err' ? 'Retry' : 'Send'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Your name and this page are attached automatically.</p>
        </div>
      )}
    </>
  );
}
