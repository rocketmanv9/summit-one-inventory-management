'use client';

/**
 * "How this works" explainer cards — one per page, so every screen can teach
 * what it does and how its pieces relate. Dismissal is remembered per page
 * (localStorage key); the header button brings the card back any time.
 *
 * Usage:
 *   const help = useHowItWorks('fleet-work-orders-help');
 *   <PageHeader actions={<>{!help.show && <HowThisWorksButton onClick={help.open} />}…</>} />
 *   {help.show && <HowItWorksCard title="How maintenance works" onDismiss={help.dismiss}
 *      steps={[…]} legend={[…]} glossary={[…]} />}
 */

import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface HowStep { title: string; body: string }
export interface HowLegendItem { badge: React.ReactNode; text: string }
export interface HowGlossaryItem { Icon: LucideIcon; term: string; blurb: string }

export function useHowItWorks(storageKey: string) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(storageKey) !== '1'); } catch { setShow(true); }
  }, [storageKey]);
  const dismiss = () => { setShow(false); try { localStorage.setItem(storageKey, '1'); } catch { /* private mode */ } };
  const open = () => { setShow(true); try { localStorage.removeItem(storageKey); } catch { /* private mode */ } };
  return { show, open, dismiss };
}

export function HowThisWorksButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm hover:bg-muted/50">
      <HelpCircle className="h-4 w-4" /> How this works
    </button>
  );
}

export function HowItWorksCard({ title, onDismiss, steps, legend, legendTitle = 'Statuses', glossary, glossaryTitle = 'What things mean', children }: {
  title: string;
  onDismiss: () => void;
  /** The page's rhythm, in order — "add it once", "we count down", … */
  steps?: HowStep[];
  /** Status badges (or other markers) with what each one means. */
  legend?: HowLegendItem[];
  legendTitle?: string;
  /** Term-by-term glossary with icons. */
  glossary?: HowGlossaryItem[];
  glossaryTitle?: string;
  /** Extra page-specific content rendered after the standard sections. */
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <button onClick={onDismiss} className="text-sm font-medium text-primary hover:underline">Got it</button>
      </div>

      <div className="p-6 space-y-6">
        {steps && steps.length > 0 && (
          <ol className={`grid gap-3 text-sm ${steps.length >= 4 ? 'sm:grid-cols-4' : steps.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">{i + 1}</span>
                  <span className="font-semibold">{s.title}</span>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        )}

        {legend && legend.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{legendTitle}</span>
            {legend.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {l.badge}
                <span className="text-muted-foreground text-xs">{l.text}</span>
              </span>
            ))}
          </div>
        )}

        {glossary && glossary.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{glossaryTitle}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {glossary.map(({ Icon, term, blurb }) => (
                <div key={term} className="flex gap-2.5 rounded-lg border p-3">
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <div className="text-xs leading-relaxed"><span className="font-semibold text-sm">{term}</span><span className="text-muted-foreground"> — {blurb}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
