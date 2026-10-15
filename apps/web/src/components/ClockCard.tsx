import { FLAG_LABELS, type GeoPoint, type PunchResult, type TodayAttendance } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Clock, LogIn, LogOut, MapPin, MapPinOff, Navigation, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { elapsed, formatDuration, formatTime } from '../lib/format';
import { distanceMeters, GeoError, getCurrentPosition } from '../lib/geo';
import { isAddressPending } from './PlaceLink';
import { PunchTimeline } from './PunchTimeline';
import { Button } from './ui/Button';
import { Banner, Card, ErrorState, Skeleton, StatusBadge } from './ui/Display';
import { useToast } from './ui/Toast';

const PunchMap = lazy(() => import('./PunchMap'));

type LocationState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'ok'; point: GeoPoint; distance: number | null }
  | { kind: 'error'; message: string };

export const todayQueryKey = ['attendance', 'today'] as const;
export const useToday = () =>
  useQuery({
    queryKey: todayQueryKey,
    queryFn: () => api.get<TodayAttendance>('/attendance/today'),
    // Refresh quickly while a punch address is still being looked up, otherwise every 5 minutes.
    refetchInterval: (query) => (isAddressPending(query.state.data?.punches) ? 4000 : 5 * 60_000),
  });

function LiveTimer({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{elapsed(from, now)}</span>;
}

function LiveClock({ tz }: { tz?: string }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 15_000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-4xl font-semibold tabular-nums sm:text-5xl">{formatTime(now, tz)}</span>;
}

function formatShiftTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

const formatMeters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/**
 * The clock-in / clock-out card: live status, one big action button, location check with map preview,
 * and today's punch log. Used on the employee home screen and in the dashboard's quick-clock dialog.
 */
export function ClockCard({ onPunched }: { onPunched?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = useToday();
  const [location, setLocation] = useState<LocationState>({ kind: 'idle' });
  const [blocked, setBlocked] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  const t = today.data;
  const office = t?.office ?? null;
  const needsLocation = t?.restrictions.geoCapture ?? true;
  const hasGeofence = office?.latitude != null && office.longitude != null;

  const locate = useCallback(async () => {
    setLocation({ kind: 'locating' });
    try {
      const point = await getCurrentPosition(Math.min(50, t?.restrictions.maxAccuracyMeters ?? 50));
      const distance = hasGeofence ? Math.round(distanceMeters(point, { latitude: office!.latitude!, longitude: office!.longitude! })) : null;
      setLocation({ kind: 'ok', point, distance });
      return point;
    } catch (err) {
      setLocation({ kind: 'error', message: err instanceof GeoError ? err.message : 'Could not get your location.' });
      throw err;
    }
  }, [hasGeofence, office, t?.restrictions.maxAccuracyMeters]);

  // If location permission is already granted, show "inside / outside office" before the tap.
  useEffect(() => {
    if (!t || !needsLocation || location.kind !== 'idle') return;
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') locate().catch(() => {});
      })
      .catch(() => {});
  }, [t, needsLocation, location.kind, locate]);

  const punch = useMutation({
    mutationFn: async (kind: 'in' | 'out') => {
      setBlocked(null);
      // Always take a fresh reading at the moment of the punch.
      const point = needsLocation ? await locate() : location.kind === 'ok' ? location.point : undefined;
      return api.post<PunchResult>(`/attendance/clock-${kind}`, { location: point });
    },
    onSuccess: (res) => {
      toast.success(res.message);
      res.warnings.forEach((w) => toast.warning('Heads up', w));
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onPunched?.();
    },
    onError: (err) => {
      if (err instanceof GeoError) return; // already shown inline
      if (err instanceof ApiError && err.status === 403) setBlocked(err.message);
      else toast.error('Could not record attendance', errorMessage(err));
      if (err instanceof ApiError && err.status === 409) qc.invalidateQueries({ queryKey: todayQueryKey });
    },
  });

  if (today.isError) return <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />;

  const record = t?.record;
  const state: 'loading' | 'out' | 'working' | 'done' = !t ? 'loading' : !record?.clockIn ? 'out' : record.clockOut ? 'done' : 'working';
  const tz = t?.timezone;
  const insideOffice = location.kind === 'ok' && location.distance !== null && office ? location.distance <= office.radiusMeters : null;

  return (
    <Card className="overflow-hidden">
      <div
        className={clsx(
          'px-5 pt-5 pb-6 text-center sm:px-8',
          state === 'working' ? 'bg-gradient-to-b from-emerald-50 to-white' : state === 'done' ? 'bg-gradient-to-b from-brand-50 to-white' : 'bg-gradient-to-b from-slate-50 to-white',
        )}
      >
        {state === 'loading' ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-12 w-56" />
            <Skeleton className="h-14 w-full max-w-xs rounded-2xl" />
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
              {state === 'out' && <span className="text-sm font-medium text-slate-600">You haven’t clocked in yet</span>}
              {state === 'working' && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                  </span>
                  Working since {formatTime(record!.clockIn, tz)}
                </span>
              )}
              {state === 'done' && <span className="text-sm font-medium text-brand-700">Clocked out at {formatTime(record!.clockOut, tz)}</span>}
              {record?.status && <StatusBadge status={record.status} />}
            </div>

            <div className="mb-5 text-slate-900">
              {state === 'working' && <LiveTimer from={record!.clockIn!} />}
              {state === 'done' && <span className="text-4xl font-semibold tabular-nums sm:text-5xl">{formatDuration(record!.workMinutes)}</span>}
              {state === 'out' && <LiveClock tz={tz} />}
            </div>

            {t?.isWeeklyOff && state === 'out' && (
              <Banner tone="info" className="mb-4 text-left">
                Today is your weekly off. You can still clock in if you’re working.
              </Banner>
            )}
            {t?.approvedRemote && (
              <Banner tone="success" className="mb-4 text-left">
                {t.approvedRemote === 'WFH' ? 'Work from home' : 'On duty'} is approved for today — you can clock in from anywhere.
              </Banner>
            )}
            {blocked && (
              <Banner tone="error" className="mb-4 text-left" title="Couldn’t record your attendance">
                {blocked}
              </Banner>
            )}

            {state === 'done' ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-slate-500">Back at work after a break or client visit?</p>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full max-w-xs"
                  loading={punch.isPending}
                  onClick={() => punch.mutate('in')}
                  icon={<RotateCcw className="size-5" />}
                >
                  {punch.isPending ? (location.kind === 'locating' ? 'Getting location…' : 'Saving…') : 'Clock in again'}
                </Button>
              </div>
            ) : (
              <Button
                size="xl"
                variant={state === 'working' ? 'danger' : 'success'}
                className="w-full max-w-xs shadow-lg"
                loading={punch.isPending}
                onClick={() => punch.mutate(state === 'working' ? 'out' : 'in')}
                icon={state === 'working' ? <LogOut className="size-5" /> : <LogIn className="size-5" />}
              >
                {punch.isPending ? (location.kind === 'locating' ? 'Getting location…' : 'Saving…') : state === 'working' ? 'Clock Out' : 'Clock In'}
              </Button>
            )}

            {/* Location status */}
            {needsLocation && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-center gap-1.5">
                  {location.kind === 'idle' && (
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Navigation className="size-4" /> Your location is checked when you tap the button
                    </span>
                  )}
                  {location.kind === 'locating' && (
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Navigation className="size-4 animate-pulse" /> Finding your location…
                    </span>
                  )}
                  {location.kind === 'ok' &&
                    (insideOffice === null ? (
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <MapPin className="size-4" /> Location found · ±{Math.round(location.point.accuracy)} m
                      </span>
                    ) : insideOffice || t?.approvedRemote ? (
                      <span className="flex items-center gap-1.5 text-emerald-700">
                        <MapPin className="size-4" /> {t?.approvedRemote && !insideOffice ? 'Remote work approved' : `You’re at ${office!.name}`} · ±{Math.round(location.point.accuracy)} m
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-amber-700">
                        <MapPinOff className="size-4 shrink-0" /> {formatMeters(location.distance!)} from {office!.name}
                        {t?.restrictions.geofenceMode === 'FLAG' && ' — HR will review'}
                        {t?.restrictions.geofenceMode === 'BLOCK' && ' — move closer to clock in'}
                      </span>
                    ))}
                  {location.kind === 'error' && (
                    <span className="flex items-center gap-1.5 text-red-600">
                      <MapPinOff className="size-4 shrink-0" /> {location.message}
                    </span>
                  )}
                </div>
                {location.kind === 'error' && (
                  <button type="button" onClick={() => locate().catch(() => {})} className="font-medium text-brand-600 hover:text-brand-700">
                    Try again
                  </button>
                )}
                {location.kind === 'ok' && (
                  <button type="button" onClick={() => setShowMap((s) => !s)} className="font-medium text-brand-600 hover:text-brand-700">
                    {showMap ? 'Hide map' : 'Show me on the map'}
                  </button>
                )}
                {showMap && location.kind === 'ok' && (
                  <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
                    <PunchMap
                      className="h-48 w-full rounded-xl border border-slate-200"
                      office={office}
                      points={[{ ...location.point, kind: 'ME', label: `You (±${Math.round(location.point.accuracy)} m)` }]}
                    />
                  </Suspense>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Today's summary */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
        {[
          { label: 'First in', value: formatTime(record?.clockIn, tz) },
          { label: 'Last out', value: formatTime(record?.clockOut, tz) },
          { label: 'Worked', value: record?.workMinutes != null ? formatDuration(record.workMinutes) : state === 'working' ? 'In progress' : '—' },
        ].map((x) => (
          <div key={x.label} className="px-2 py-3">
            <p className="text-xs text-slate-500">{x.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums">{x.value}</p>
          </div>
        ))}
      </div>
      {t?.shift && (
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          <Clock className="size-3.5" />
          {t.shift.name}: {formatShiftTime(t.shift.startTime)} – {formatShiftTime(t.shift.endTime)} · {t.shift.graceMinutes} min grace
        </div>
      )}
      {record && record.flags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 border-t border-slate-100 px-4 py-2.5">
          {record.flags.map((f) => (
            <span key={f} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {FLAG_LABELS[f] ?? f}
            </span>
          ))}
        </div>
      )}
      {!!t?.punches.length && (
        <details className="group border-t border-slate-100">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Today’s activity ({t.punches.length} {t.punches.length === 1 ? 'entry' : 'entries'})
            <span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden>
              ▾
            </span>
          </summary>
          <div className="px-5 pt-1 pb-4">
            <PunchTimeline punches={t.punches} office={office} timezone={tz} />
          </div>
        </details>
      )}
    </Card>
  );
}
