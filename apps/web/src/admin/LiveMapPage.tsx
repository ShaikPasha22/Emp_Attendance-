import type { LiveMapEmployee, LiveMapResponse } from '@app/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Globe2, LocateFixed, MapPinned, Search } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaceLink } from '../components/PlaceLink';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '../components/ui/Display';
import { Input, Segmented, Select } from '../components/ui/Field';
import { api, errorMessage } from '../lib/api';
import { formatDuration, todayKey } from '../lib/format';
import type { FitRequest, Pinned } from './live/LiveMap';
import { useLiveEvents, type LiveConnection } from './live/useLiveEvents';

const LiveMap = lazy(() => import('./live/LiveMap'));

type StatusFilter = 'ALL' | 'WORKING' | 'CLOCKED_OUT';
const INDIA_BOUNDS: [number, number][] = [
  [6.5, 68.0],
  [35.5, 97.5],
];
/** How long a freshly updated pin keeps pulsing. */
const PULSE_MS = 8000;

const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(iso)) : '—';
const hasPin = (e: LiveMapEmployee): e is Pinned => !!e.lastPunch;

export default function LiveMapPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayKey());
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [region, setRegion] = useState('');
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [recent, setRecent] = useState<Map<string, number>>(new Map());
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isToday = date === todayKey();

  // Live push: on any clock-in / out in scope, refetch (debounced) and pulse that person's pin.
  const onPunch = useCallback(
    (userId: string) => {
      setRecent((m) => new Map(m).set(userId, Date.now()));
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => qc.invalidateQueries({ queryKey: ['live-map'] }), 300);
    },
    [qc],
  );
  const connection = useLiveEvents(isToday, onPunch);

  const q = useQuery({
    queryKey: ['live-map', date],
    queryFn: () => api.get<LiveMapResponse>(`/admin/live-map?date=${date}`),
    // The stream drives updates; polling is only a safety net when the stream is down.
    refetchInterval: isToday ? (connection === 'live' ? 120_000 : 20_000) : false,
    placeholderData: (p) => p,
  });

  // Expire pulses.
  useEffect(() => {
    if (!recent.size) return;
    const t = setTimeout(() => setRecent((m) => new Map([...m].filter(([, at]) => Date.now() - at < PULSE_MS))), PULSE_MS);
    return () => clearTimeout(t);
  }, [recent]);
  useEffect(() => () => clearTimeout(refetchTimer.current), []);

  const data = q.data;
  const tz = data?.timezone ?? 'Asia/Kolkata';
  const departments = useMemo(() => [...new Set((data?.employees ?? []).map((e) => e.department).filter(Boolean) as string[])].sort(), [data]);
  const regions = useMemo(() => {
    const byState = new Map<string, number>();
    for (const e of data?.employees ?? []) if (e.lastPunch?.state) byState.set(e.lastPunch.state, (byState.get(e.lastPunch.state) ?? 0) + 1);
    return [...byState.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.employees ?? []).filter(
      (e) =>
        (status === 'ALL' || e.liveStatus === status || (status === 'CLOCKED_OUT' && e.liveStatus === 'CLOCKED_OUT')) &&
        (!department || e.department === department) &&
        (!region || e.lastPunch?.state === region) &&
        (!s || e.name.toLowerCase().includes(s) || e.employeeCode.toLowerCase().includes(s)),
    );
  }, [data, status, department, region, search]);
  const pinned = filtered.filter(hasPin);
  const recentIds = useMemo(() => new Set(recent.keys()), [recent]);

  const fitTo = (points: [number, number][]) => setFit({ bounds: points, nonce: Date.now() });
  const pinsOf = (list: Pinned[]) => list.map((e) => [e.lastPunch.latitude, e.lastPunch.longitude] as [number, number]);

  // First load: frame everyone (and their offices).
  const framed = useRef(false);
  useEffect(() => {
    if (!data || framed.current) return;
    framed.current = true;
    const pts = [...pinsOf(data.employees.filter(hasPin)), ...data.offices.map((o) => [o.latitude, o.longitude] as [number, number])];
    fitTo(pts.length ? pts : INDIA_BOUNDS);
  }, [data]);

  /** State view frames that state's pins; country view ('') frames every pin. */
  const chooseRegion = (value: string) => {
    setRegion(value);
    const list = (data?.employees ?? []).filter(hasPin).filter((e) => !value || e.lastPunch.state === value);
    fitTo(list.length ? pinsOf(list) : INDIA_BOUNDS);
  };

  const working = filtered.filter((e) => e.liveStatus === 'WORKING');
  const clockedOut = filtered.filter((e) => e.liveStatus === 'CLOCKED_OUT');
  const notIn = filtered.filter((e) => e.liveStatus === 'NOT_IN');

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Live map <LiveBadge connection={isToday ? connection : 'offline'} isToday={isToday} />
          </span>
        }
        description="Where your team clocked in or out — pins update the moment someone clocks in."
        actions={<Input type="date" aria-label="Date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} className="w-40" />}
      />

      {/* Summary */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <SummaryTile label="Working now" value={data?.summary.working} dot="bg-emerald-500" />
        <SummaryTile label="Clocked out" value={data?.summary.clockedOut} dot="bg-slate-400" />
        <SummaryTile label="Not clocked in" value={data?.summary.notIn} dot="bg-white ring-1 ring-slate-300" />
        <SummaryTile label="Outside office" value={data?.summary.outsideOffice} dot="bg-white ring-[3px] ring-red-500" />
      </div>

      {/* Toolbar */}
      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <Segmented<StatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'WORKING', label: 'Working' },
            { value: 'CLOCKED_OUT', label: 'Clocked out' },
          ]}
        />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find employee"
            aria-label="Find employee"
            className="block h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
        </div>
        {departments.length > 1 && (
          <Select
            aria-label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            options={departments.map((d) => ({ value: d, label: d }))}
            placeholder="All departments"
            className="hidden sm:block lg:w-48"
          />
        )}
        <div className="flex gap-2">
          <Select
            aria-label="State view"
            value={region}
            onChange={(e) => chooseRegion(e.target.value)}
            options={regions.map(([s, n]) => ({ value: s, label: `${s} (${n})` }))}
            placeholder="Country view — all states"
            className="flex-1 lg:w-60"
          />
          <button
            type="button"
            onClick={() => chooseRegion('')}
            title="Country view"
            aria-label="Country view"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <Globe2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => fitTo(pinsOf(pinned))}
            title="Fit all pins"
            aria-label="Fit all pins"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <LocateFixed className="size-4" />
          </button>
        </div>
      </Card>

      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="relative h-[60vh] overflow-hidden lg:h-[calc(100dvh-330px)] lg:min-h-[480px]">
            {!data ? (
              <Skeleton className="h-full w-full rounded-none" />
            ) : (
              <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                <LiveMap employees={pinned} offices={data.offices} fit={fit} focus={focus} recent={recentIds} timezone={tz} />
              </Suspense>
            )}
            <div className="pointer-events-none absolute bottom-6 left-3 z-[400] flex flex-wrap gap-3 rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-600 shadow">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full border-2 border-white bg-emerald-600 shadow" /> Working
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full border-2 border-white bg-slate-400 shadow" /> Clocked out
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-white ring-[3px] ring-red-500" /> Outside office
              </span>
            </div>
          </Card>

          <Card className="flex max-h-[70vh] flex-col overflow-hidden lg:h-[calc(100dvh-330px)] lg:max-h-none lg:min-h-[480px]">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="font-semibold text-slate-900">People ({filtered.length})</p>
              <p className="text-xs text-slate-500">Tap a name to find them on the map</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!data ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : (
                <>
                  <PeopleGroup title="Working now" people={working} tz={tz} recent={recentIds} onPick={(id) => setFocus({ id, nonce: Date.now() })} />
                  <PeopleGroup title="Clocked out" people={clockedOut} tz={tz} recent={recentIds} onPick={(id) => setFocus({ id, nonce: Date.now() })} />
                  <PeopleGroup title="Not clocked in" people={notIn} tz={tz} recent={recentIds} collapsed />
                  {filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No one matches these filters.</p>}
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function LiveBadge({ connection, isToday }: { connection: LiveConnection; isToday: boolean }) {
  if (!isToday) return <Badge>History</Badge>;
  if (connection === 'live')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    );
  return <Badge tone="amber">{connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</Badge>;
}

function SummaryTile({ label, value, dot }: { label: string; value: number | undefined; dot: string }) {
  return (
    <Card className="flex flex-col items-start gap-1 px-2.5 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3">
      <span className={clsx('size-2.5 shrink-0 rounded-full sm:size-3', dot)} />
      <div className="min-w-0">
        <p className="text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">{value ?? '–'}</p>
        <p className="text-[11px] leading-tight text-slate-500 sm:text-xs">{label}</p>
      </div>
    </Card>
  );
}

function PeopleGroup({
  title,
  people,
  tz,
  recent,
  onPick,
  collapsed,
}: {
  title: string;
  people: LiveMapEmployee[];
  tz: string;
  recent: Set<string>;
  onPick?: (id: string) => void;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  if (!people.length) return null;
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between bg-slate-50/70 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title} ({people.length})<span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-100">
          {people.map((e) => (
            <li key={e.id}>
              <div
                role={onPick && e.lastPunch ? 'button' : undefined}
                tabIndex={onPick && e.lastPunch ? 0 : undefined}
                onClick={() => e.lastPunch && onPick?.(e.id)}
                onKeyDown={(ev) => ev.key === 'Enter' && e.lastPunch && onPick?.(e.id)}
                className={clsx('px-4 py-2.5', onPick && e.lastPunch && 'cursor-pointer hover:bg-slate-50', recent.has(e.id) && 'bg-emerald-50/70')}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {e.name}
                    {recent.has(e.id) && <span className="ml-2 text-xs font-normal text-emerald-700">just now</span>}
                  </p>
                  {e.lastPunch?.outsideOffice && <Badge tone="red">Outside</Badge>}
                </div>
                <p className="truncate text-xs text-slate-500">
                  {e.liveStatus === 'NOT_IN'
                    ? (e.designation ?? e.department ?? e.employeeCode)
                    : `In ${fmtTime(e.firstIn, tz)}${e.lastOut ? ` · Out ${fmtTime(e.lastOut, tz)} · ${formatDuration(e.workMinutes)}` : ''}`}
                </p>
                {e.lastPunch && <PlaceLink place={e.lastPunch} compact className="mt-0.5 text-xs" />}
                {e.liveStatus !== 'NOT_IN' && !e.lastPunch && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                    <MapPinned className="size-3" /> No location (location not required)
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
