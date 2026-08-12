'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, ChevronDown, Check, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActiveLocation, ALL_LOCATIONS } from '@/lib/active-location';

/**
 * Top-nav active-location picker. The single loudest piece of chrome after the
 * logo: it names the yard whose data the app is currently showing ("Viewing:
 * Portland"), so you can never lose track of where you are. Choosing a location
 * scopes location-aware pages to it; "All locations" restores the tenant-wide view.
 *
 * Unlike ViewAsPicker this is visible to everyone — it's context, not access.
 */
export function LocationPicker() {
  const { activeLocationId, activeLocation, isScoped, locations, setActiveLocationId } = useActiveLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Nothing to switch between until at least one location exists.
  if (locations.length === 0) return null;

  const label = isScoped ? activeLocation?.name ?? 'This location' : 'All locations';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
          isScoped
            ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-input text-foreground hover:bg-muted',
        )}
        aria-label="Active location"
        title="Choose which location's data to show across the app"
      >
        {isScoped ? <MapPin className="h-4 w-4 shrink-0" /> : <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="max-w-[12rem] truncate">
          <span className="text-[11px] font-normal opacity-70">Viewing: </span>
          {label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 max-h-96 w-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
          <div className="p-1.5">
            <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Show data for…
            </p>
            <button
              onClick={() => { setActiveLocationId(ALL_LOCATIONS); setOpen(false); }}
              className="flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                All locations <span className="text-xs text-muted-foreground">(tenant-wide)</span>
              </span>
              {!isScoped && <Check className="h-4 w-4 text-primary" />}
            </button>
            <div className="my-1 h-px bg-border" />
            {locations.map((loc) => {
              const active = activeLocationId === loc.id;
              return (
                <button
                  key={loc.id}
                  onClick={() => { setActiveLocationId(loc.id); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{loc.name}</span>
                      {loc.location_type_name && (
                        <span className="block truncate text-xs capitalize text-muted-foreground">{loc.location_type_name}</span>
                      )}
                    </span>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
