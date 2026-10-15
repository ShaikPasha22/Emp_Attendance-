import { FLAG_LABELS, STATUS_META, type AttendanceDay, type AttendanceDayDetail, type AttendanceStatus, type MonthAttendance } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ButtonLink, IconButton } from '../components/ui/Button';
import { Badge, Card, DefinitionList, ErrorState, PageHeader, Skeleton, StatusBadge, toneDot } from '../components/ui/Display';
import { Dialog } from '../components/ui/Dialog';
import { isAddressPending } from '../components/PlaceLink';
import { PunchTimeline } from '../components/PunchTimeline';
import { api, errorMessage } from '../lib/api';
import { currentMonth, formatDate, formatDuration, formatMonth, formatTime, shiftMonth, todayKey } from '../lib/format';

const cellTone: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  yellow: 'bg-yellow-50 text-yellow-900 ring-yellow-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  slate: 'bg-slate-100 text-slate-500 ring-slate-200',
  purple: 'bg-purple-50 text-purple-800 ring-purple-200',
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200',
};

/** Every clock-in / clock-out of the day with where it happened. */
function DayActivity({ date }: { date: string }) {
  const q = useQuery({
    queryKey: ['attendance', 'day', date],
    queryFn: () => api.get<AttendanceDayDetail>(`/attendance/me/day/${date}`),
    // Addresses are looked up in the background; refresh briefly until they arrive.
    refetchInterval: (query) => (isAddressPending(query.state.data?.punches) ? 4000 : false),
  });
  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="mb-2 text-sm font-medium text-slate-700">Activity</p>
      {q.isLoading ? <Skeleton className="h-16" /> : q.data ? <PunchTimeline punches={q.data.punches} office={q.data.office} timezone={q.data.timezone} /> : null}
    </div>
  );
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<{ date: string; day: AttendanceDay | null } | null>(null);
  const q = useQuery({
    queryKey: ['attendance', 'month', month],
    queryFn: () => api.get<MonthAttendance>(`/attendance/me?month=${month}`),
    placeholderData: (prev) => prev,
  });

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y!, m! - 1, 1));
    const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday-first
    const byDate = new Map((q.data?.days ?? []).map((d) => [d.date, d]));
    const list: ({ date: string; day: AttendanceDay | null; weekday: number } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      list.push({ date, day: byDate.get(date) ?? null, weekday: ((lead + d - 1) % 7) + 1 });
    }
    return list;
  }, [month, q.data]);

  const today = todayKey();
  const summary = q.data?.summary;
  const tz = q.data?.timezone;
  const usedStatuses = (Object.keys(STATUS_META) as AttendanceStatus[]).filter((s) => summary?.[s]);

  return (
    <div>
      <PageHeader title="My attendance" description="Tap a day to see details or request a correction." />
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-2 py-2 sm:px-4">
          <IconButton label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <h2 className="font-semibold text-slate-900">{formatMonth(month)}</h2>
          <IconButton label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonth()} className="disabled:opacity-30">
            <ChevronRight className="size-5" />
          </IconButton>
        </div>

        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <div className="p-2 sm:p-4">
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
              {WEEKDAY_HEADERS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((c, i) => {
                if (!c) return <div key={`pad-${i}`} />;
                const status = c.day?.status ?? (q.data?.weeklyOffs.includes(c.weekday) && c.date < today ? 'WO' : null);
                const meta = status ? STATUS_META[status] : null;
                const future = c.date > today;
                return (
                  <button
                    key={c.date}
                    type="button"
                    disabled={future}
                    onClick={() => setSelected({ date: c.date, day: c.day })}
                    aria-label={`${formatDate(c.date)}: ${meta?.label ?? (future ? 'upcoming' : 'no record')}`}
                    className={clsx(
                      'flex aspect-square flex-col items-center justify-center rounded-lg text-sm ring-1 ring-inset transition-transform active:scale-95 sm:aspect-auto sm:h-16',
                      meta ? cellTone[meta.tone] : future ? 'text-slate-300 ring-transparent' : 'bg-white text-slate-700 ring-slate-100 hover:bg-slate-50',
                      c.date === today && 'ring-2 ring-brand-500',
                    )}
                  >
                    <span className="font-medium tabular-nums">{Number(c.date.slice(8))}</span>
                    {q.isFetching && !q.data ? (
                      <Skeleton className="mt-1 h-3 w-5" />
                    ) : (
                      status && <span className="text-[10px] leading-tight font-semibold sm:text-xs">{status}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
            {(usedStatuses.length ? usedStatuses : (['P', 'L', 'HD', 'A', 'WO'] as AttendanceStatus[])).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={clsx('size-2.5 rounded-full', toneDot[STATUS_META[s].tone])} />
                {STATUS_META[s].label}
                {summary?.[s] ? <strong className="tabular-nums">{summary[s]}</strong> : null}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Total worked this month: {formatDuration(summary?.workMinutes ?? 0)}</p>
        </div>
      </Card>

      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? formatDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
        footer={
          selected && (
            <ButtonLink to={`/requests/new?type=REGULARIZATION&date=${selected.date}`} variant="secondary" icon={<FileText className="size-4" />}>
              Request correction
            </ButtonLink>
          )
        }
      >
        {selected && (
          <div className="space-y-3">
            <DefinitionList
              items={[
                { label: 'Status', value: <StatusBadge status={selected.day?.status} /> },
                { label: 'Clock in', value: formatTime(selected.day?.clockIn, tz) },
                { label: 'Clock out', value: formatTime(selected.day?.clockOut, tz) },
                { label: 'Worked', value: formatDuration(selected.day?.workMinutes) },
                ...(selected.day?.lateMinutes ? [{ label: 'Late by', value: formatDuration(selected.day.lateMinutes) }] : []),
                ...(selected.day?.inDistanceMeters != null ? [{ label: 'Distance from office (in)', value: `${Math.round(selected.day.inDistanceMeters)} m` }] : []),
                ...(selected.day?.source && selected.day.source !== 'APP' ? [{ label: 'Source', value: selected.day.source === 'REGULARIZED' ? 'Corrected (approved request)' : selected.day.source === 'HR_OVERRIDE' ? 'Updated by HR' : 'System' }] : []),
              ]}
            />
            {!!selected.day?.flags.length && (
              <div className="flex flex-wrap gap-1.5">
                {selected.day.flags.map((f) => (
                  <Badge key={f}>{FLAG_LABELS[f] ?? f}</Badge>
                ))}
              </div>
            )}
            {selected.day?.reviewStatus === 'PENDING' && <p className="text-sm text-fuchsia-700">This entry is waiting for HR review.</p>}
            {!selected.day && <p className="text-sm text-slate-500">No attendance recorded for this day.</p>}
            {selected.day?.clockIn && <DayActivity date={selected.date} />}
          </div>
        )}
      </Dialog>
    </div>
  );
}
