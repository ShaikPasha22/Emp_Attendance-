import { FLAG_LABELS, type AttendancePunchDto, type OfficeInfo } from '@app/shared';
import { clsx } from 'clsx';
import { LogIn, LogOut, MapPinOff } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { formatTime } from '../lib/format';
import { PlaceLink } from './PlaceLink';
import { Skeleton } from './ui/Display';
import type { MapPoint } from './PunchMap';

const PunchMap = lazy(() => import('./PunchMap'));

const formatMeters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Chronological list of every clock-in / clock-out with where it happened. */
export function PunchTimeline({
  punches,
  office,
  timezone,
  showMap = true,
  mapOpenByDefault = false,
}: {
  punches: AttendancePunchDto[];
  office: OfficeInfo | null;
  timezone?: string;
  showMap?: boolean;
  mapOpenByDefault?: boolean;
}) {
  const [mapOpen, setMapOpen] = useState(mapOpenByDefault);
  if (!punches.length) return <p className="text-sm text-slate-500">No clock-ins recorded.</p>;
  const points: MapPoint[] = punches
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({
      latitude: p.latitude!,
      longitude: p.longitude!,
      accuracy: p.accuracy,
      kind: p.type,
      label: `${p.type === 'IN' ? 'Clock in' : 'Clock out'} · ${formatTime(p.at, timezone)}`,
    }));

  return (
    <div className="space-y-3">
      <ol className="relative space-y-3 border-l border-slate-200 pl-5">
        {punches.map((p) => {
          const outside = office && p.distanceMeters != null && p.distanceMeters > office.radiusMeters;
          return (
            <li key={p.id} className="relative">
              <span
                className={clsx(
                  'absolute top-0.5 -left-[29px] flex size-6 items-center justify-center rounded-full ring-4 ring-white',
                  p.type === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                )}
              >
                {p.type === 'IN' ? <LogIn className="size-3.5" /> : <LogOut className="size-3.5" />}
              </span>
              <p className="text-sm font-medium text-slate-900">
                {p.type === 'IN' ? 'Clock in' : 'Clock out'} <span className="font-normal text-slate-500 tabular-nums">· {formatTime(p.at, timezone)}</span>
              </p>
              {p.latitude == null ? (
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPinOff className="size-3.5" /> No location captured
                </p>
              ) : (
                <div className="space-y-0.5 text-xs">
                  <PlaceLink place={p} className="text-sm" />
                  <p className={clsx('pl-5', outside ? 'text-amber-700' : 'text-slate-500')}>
                    {p.distanceMeters != null && office ? `${formatMeters(p.distanceMeters)} from ${office.name}` : 'Location captured'}
                    {p.accuracy != null && ` · GPS ±${Math.round(p.accuracy)} m`}
                  </p>
                </div>
              )}
              {p.flags.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-1">
                  {p.flags.map((f) => (
                    <span key={f} className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-[11px] text-fuchsia-700">
                      {FLAG_LABELS[f] ?? f}
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {punches.some((p) => p.address && p.address !== office?.name) && <p className="text-[11px] text-slate-400">Addresses © OpenStreetMap contributors</p>}
      {showMap && points.length > 0 && (
        <div>
          {mapOpen ? (
            <Suspense fallback={<Skeleton className="h-56 w-full rounded-xl" />}>
              <PunchMap office={office} points={points} />
            </Suspense>
          ) : (
            <button type="button" onClick={() => setMapOpen(true)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
              Show on map
            </button>
          )}
        </div>
      )}
    </div>
  );
}
