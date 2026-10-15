import type { PunchPlace } from '@app/shared';
import { clsx } from 'clsx';
import { ExternalLink, MapPin } from 'lucide-react';

/** "MG Road, Bengaluru ↗" — readable place with a one-tap link to Google Maps. */
export function PlaceLink({ place, className, compact }: { place: Pick<PunchPlace, 'address' | 'mapUrl'> | null | undefined; className?: string; compact?: boolean }) {
  if (!place?.mapUrl) return <span className={clsx('text-slate-400', className)}>—</span>;
  // The address is looked up in the background; until then (or if it fails) link straight to the map.
  const label = place.address ?? 'View on map';
  return (
    <a
      href={place.mapUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${label} — open in Google Maps`}
      className={clsx('group inline-flex max-w-full gap-1 text-slate-700 hover:text-brand-700', compact ? 'items-center' : 'items-start', className)}
    >
      <MapPin className={clsx('size-3.5 shrink-0 text-slate-400 group-hover:text-brand-600', !compact && 'mt-0.5')} />
      {/* Compact (tables) truncates with a tooltip; full mode wraps so the whole address is readable. */}
      <span className={clsx(!place.address && 'text-slate-400 italic', compact ? 'max-w-40 truncate' : 'break-words')}>{label}</span>
      <ExternalLink className={clsx('size-3 shrink-0 text-slate-400 group-hover:text-brand-600', !compact && 'mt-1')} aria-hidden />
    </a>
  );
}

/** True while a just-made punch is still waiting for its address (looked up in the background). */
export const isAddressPending = (punches: { mapUrl: string | null; address: string | null; at: string }[] | undefined) =>
  !!punches?.some((p) => p.mapUrl && !p.address && Date.now() - new Date(p.at).getTime() < 2 * 60_000);
