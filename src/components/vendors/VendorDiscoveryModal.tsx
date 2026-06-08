'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Search,
  Loader2,
  MapPin,
  Phone,
  Globe,
  Mail,
  Check,
  Plus,
  Pencil,
  Navigation,
} from 'lucide-react';
import { discoverVendors, type VendorCandidate } from '@/lib/ai/client';
import { createVendorFromDraft, type VendorDraft } from '@/lib/vendor-draft';
import { geocodeStructured, distanceMiles } from '@/lib/geocode';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface VendorDiscoveryModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing vendor names, used to flag candidates you already have. */
  existingNames: string[];
  /** Open the full vendor form prefilled with this draft (review-and-edit). */
  onReview: (draft: VendorDraft) => void;
  /** Fired after a successful one-click add so the parent can refresh. */
  onAdded: () => void;
}

/** A tenant location used as the "distance from" anchor. */
interface MyLocation {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** A candidate enriched with a stable key + geocoded coordinates. */
interface DiscoveredVendor extends VendorCandidate {
  _key: string;
  _lat?: number | null;
  _lng?: number | null;
}

const EXAMPLES = [
  'auto parts vendor near Portland',
  'a FleetPride branch in Vancouver WA',
  'asphalt sealcoat supplier near Salem OR',
  'equipment rental in Beaverton',
];

/** Normalize a vendor name for loose duplicate matching. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function candidateToDraft(c: VendorCandidate): VendorDraft {
  return {
    name: c.name,
    code: c.code,
    notes: c.category ? `Category: ${c.category}` : undefined,
    website: c.website,
    address:
      c.street1 || c.city || c.state || c.zip
        ? { street1: c.street1, city: c.city, state: c.state, zip: c.zip }
        : undefined,
    contact: c.phone || c.email ? { phone: c.phone, email: c.email } : undefined,
  };
}

function formatAddress(c: VendorCandidate): string {
  const cityLine = [c.city, c.state].filter(Boolean).join(', ');
  return [c.street1, [cityLine, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

function hasGeoQuery(c: VendorCandidate): boolean {
  return !!(c.street1 || c.city || c.zip);
}

export function VendorDiscoveryModal({
  open,
  onClose,
  existingNames,
  onReview,
  onAdded,
}: VendorDiscoveryModalProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<DiscoveredVendor[]>([]);
  // _key -> 'saving' | 'added'; tracks per-card one-click add state.
  const [addState, setAddState] = useState<Record<string, 'saving' | 'added'>>({});
  const [error, setError] = useState<string | null>(null);

  // Distance ranking
  const [myLocations, setMyLocations] = useState<MyLocation[]>([]);
  const [fromLocId, setFromLocId] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  // Bumped on each new search so a stale background geocode loop bails out.
  const searchSeq = useRef(0);

  const geoLocations = myLocations.filter((l) => l.latitude != null && l.longitude != null);
  const fromLoc = geoLocations.find((l) => l.id === fromLocId) || null;

  // Load tenant locations once when the modal opens (for the "distance from" anchor).
  useEffect(() => {
    if (!open || myLocations.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const locs = await InventoryRPC.getLocations({ active: true });
        if (cancelled) return;
        const mapped = (locs || []).map((l: any) => ({
          id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude,
        })) as MyLocation[];
        setMyLocations(mapped);
        const firstGeo = mapped.find((l) => l.latitude != null && l.longitude != null);
        if (firstGeo) setFromLocId((prev) => prev || firstGeo.id);
      } catch {
        // Distance ranking is best-effort — fall back to unranked results.
      }
    })();
    return () => { cancelled = true; };
  }, [open, myLocations.length]);

  const existingSet = new Set(existingNames.map(normalizeName));

  function distanceOf(c: DiscoveredVendor): number | null {
    if (!fromLoc?.latitude || !fromLoc?.longitude || c._lat == null || c._lng == null) return null;
    return distanceMiles(
      { lat: fromLoc.latitude, lng: fromLoc.longitude },
      { lat: c._lat, lng: c._lng },
    );
  }

  // Background-geocode each candidate so distances can be computed, then settle.
  async function geocodeResults(found: DiscoveredVendor[], seq: number) {
    setGeocoding(true);
    for (const c of found) {
      if (searchSeq.current !== seq) return; // superseded by a newer search
      if (!hasGeoQuery(c)) continue;
      const geo = await geocodeStructured({ street1: c.street1, city: c.city, state: c.state, zip: c.zip });
      if (searchSeq.current !== seq) return;
      if (geo) {
        setResults((prev) =>
          prev.map((r) => (r._key === c._key ? { ...r, _lat: geo.latitude, _lng: geo.longitude } : r)),
        );
      }
    }
    if (searchSeq.current === seq) setGeocoding(false);
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearched(false);
    setError(null);
    setResults([]);
    setAddState({});
    setGeocoding(false);
    try {
      const found = await discoverVendors(q);
      if (searchSeq.current !== seq) return;
      const enriched: DiscoveredVendor[] = found.map((c, i) => ({ ...c, _key: `${seq}-${i}` }));
      setResults(enriched);
      // Kick off geocoding in the background; results render immediately.
      void geocodeResults(enriched, seq);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      if (searchSeq.current === seq) {
        setSearching(false);
        setSearched(true);
      }
    }
  }

  async function quickAdd(candidate: DiscoveredVendor) {
    setAddState((prev) => ({ ...prev, [candidate._key]: 'saving' }));
    setError(null);
    try {
      await createVendorFromDraft(candidateToDraft(candidate));
      setAddState((prev) => ({ ...prev, [candidate._key]: 'added' }));
      onAdded();
    } catch (err: any) {
      setAddState((prev) => {
        const next = { ...prev };
        delete next[candidate._key];
        return next;
      });
      setError(err?.message || `Failed to add ${candidate.name}.`);
    }
  }

  // Render order: by distance asc (geocoded first), then the rest in original order.
  const displayed = results
    .map((c) => ({ c, d: distanceOf(c) }))
    .sort((a, b) => {
      if (a.d == null && b.d == null) return 0;
      if (a.d == null) return 1;
      if (b.d == null) return -1;
      return a.d - b.d;
    });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Find Vendors Online</DialogTitle>
          <DialogDescription>
            Describe what you need and where, and we&apos;ll search the web for matching suppliers you can add.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Search bar */}
          <div className="flex gap-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
              placeholder="e.g. auto parts vendor near Portland"
            />
            <Button onClick={runSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1.5">Search</span>
            </Button>
          </div>

          {/* Distance-from anchor (only when we have geocoded locations) */}
          {geoLocations.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Navigation className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Distance from</span>
              <select
                value={fromLocId}
                onChange={(e) => setFromLocId(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {geoLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              {geocoding && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> calculating distances…
                </span>
              )}
            </div>
          )}

          {/* Example prompts (before first search) */}
          {!searched && !searching && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {searching && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching the web for suppliers…
            </div>
          )}

          {!searching && searched && results.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No matching vendors found. Try a broader description or a different location.
            </div>
          )}

          {/* Results */}
          {!searching && displayed.length > 0 && (
            <div className="space-y-2">
              {displayed.map(({ c, d }) => {
                const already = existingSet.has(normalizeName(c.name));
                const state = addState[c._key];
                return (
                  <div key={c._key} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-sm font-semibold">{c.name}</h4>
                          {d != null && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                              <Navigation className="h-2.5 w-2.5" />
                              {d < 10 ? d.toFixed(1) : Math.round(d)} mi
                            </span>
                          )}
                          {already && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              Already in your vendors
                            </span>
                          )}
                        </div>
                        {c.category && (
                          <p className="text-xs text-muted-foreground">{c.category}</p>
                        )}
                        <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                          {formatAddress(c) && (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3 shrink-0" /> {formatAddress(c)}
                            </p>
                          )}
                          {c.phone && (
                            <p className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 shrink-0" /> {c.phone}
                            </p>
                          )}
                          {c.email && (
                            <p className="flex items-center gap-1.5">
                              <Mail className="h-3 w-3 shrink-0" /> {c.email}
                            </p>
                          )}
                          {c.website && (
                            <p className="flex items-center gap-1.5">
                              <Globe className="h-3 w-3 shrink-0" />
                              <a
                                href={/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-blue-600 hover:underline"
                              >
                                {c.website}
                              </a>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Per-result actions */}
                      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                        {state === 'added' ? (
                          <span className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                            <Check className="h-3.5 w-3.5" /> Added
                          </span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => quickAdd(c)}
                              disabled={state === 'saving'}
                            >
                              {state === 'saving' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1">Add</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onReview(candidateToDraft(c))}
                              disabled={state === 'saving'}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span className="ml-1">Review &amp; edit</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                Results come from a web search and may be incomplete — review details after adding.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
