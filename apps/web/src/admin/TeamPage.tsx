import type { AttendanceDay, AttendanceDayDetail } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { IconButton } from '../components/ui/Button';
import { isAddressPending, PlaceLink } from '../components/PlaceLink';
import { PunchTimeline } from '../components/PunchTimeline';
import { Avatar, Badge, Card, DefinitionList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../components/ui/Display';
import { Dialog } from '../components/ui/Dialog';
import { Tabs } from '../components/ui/Data';
import { api, errorMessage } from '../lib/api';
import { currentMonth, formatDate, formatDuration, formatMonth, formatTime, shiftMonth } from '../lib/format';
import { daysOfMonth, MonthGrid, StatusLegend, toCells } from './MonthGrid';

interface TeamToday {
  date: string;
  members: { id: string; name: string; employeeCode: string; department: string | null; designation: string | null; direct: boolean; record: AttendanceDay | null }[];
}
interface TeamMonth {
  month: string;
  members: { id: string; name: string; employeeCode: string; department: string | null; days: AttendanceDay[] }[];
}

export default function TeamPage() {
  const [tab, setTab] = useState<'today' | 'month'>('today');
  const [month, setMonth] = useState(currentMonth());
  const today = useQuery({ queryKey: ['team', 'today'], queryFn: () => api.get<TeamToday>('/team/today'), refetchInterval: 60_000 });
  const monthQ = useQuery({
    queryKey: ['team', 'month', month],
    queryFn: () => api.get<TeamMonth>(`/team/attendance?month=${month}`),
    enabled: tab === 'month',
    placeholderData: (p) => p,
  });
  const days = useMemo(() => daysOfMonth(month), [month]);
  const [openDay, setOpenDay] = useState<{ userId: string; name: string; date: string } | null>(null);
  const members = today.data?.members ?? [];
  const inCount = members.filter((m) => m.record?.clockIn).length;

  return (
    <div>
      <PageHeader title="My team" description={today.data ? `${inCount} of ${members.length} clocked in today` : undefined} />
      <Card>
        <div className="px-4 pt-1 sm:px-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'today', label: 'Today' },
              { value: 'month', label: 'Monthly view' },
            ]}
          />
        </div>

        {tab === 'today' ? (
          today.isError ? (
            <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />
          ) : today.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <EmptyState icon={<UsersRound className="size-6" />} title="No team members" description="Employees who report to you will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5"
                  onClick={() => setOpenDay({ userId: m.id, name: m.name, date: today.data!.date })}
                >
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {m.name} {!m.direct && <Badge className="ml-1">Indirect</Badge>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {m.designation ?? m.department ?? m.employeeCode}
                      {m.record?.clockIn && ` · In ${formatTime(m.record.clockIn)}`}
                      {m.record?.clockOut && ` · Out ${formatTime(m.record.clockOut)} (${formatDuration(m.record.workMinutes)})`}
                    </p>
                    {m.record?.inPlace && <PlaceLink place={m.record.inPlace} compact className="mt-0.5 text-xs" />}
                  </div>
                  {m.record?.status ? <StatusBadge status={m.record.status} /> : <Badge>Not in</Badge>}
                </li>
              ))}
            </ul>
          )
        ) : (
          <div>
            <div className="flex items-center justify-between px-2 py-2 sm:px-4">
              <IconButton label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                <ChevronLeft className="size-5" />
              </IconButton>
              <span className="font-medium text-slate-800">{formatMonth(month)}</span>
              <IconButton label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonth()} className="disabled:opacity-30">
                <ChevronRight className="size-5" />
              </IconButton>
            </div>
            {monthQ.isError ? (
              <ErrorState message={errorMessage(monthQ.error)} onRetry={() => monthQ.refetch()} />
            ) : !monthQ.data ? (
              <Skeleton className="m-4 h-40" />
            ) : (
              <>
                <MonthGrid
                  days={days}
                  rows={monthQ.data.members.map((m) => ({ id: m.id, name: m.name, sub: m.department, cells: toCells(days, m.days) }))}
                  onCell={(userId, date) => setOpenDay({ userId, date, name: monthQ.data!.members.find((m) => m.id === userId)?.name ?? '' })}
                />
                <div className="border-t border-slate-100 px-4 py-3">
                  <StatusLegend statuses={['P', 'L', 'HD', 'EO', 'A', 'WFH', 'OD', 'WO', 'MP', 'FL']} />
                </div>
              </>
            )}
          </div>
        )}
      </Card>
      <MemberDayDialog day={openDay} onClose={() => setOpenDay(null)} />
    </div>
  );
}

/** A team member's day: status, hours and every clock-in / clock-out with place name and map link. */
function MemberDayDialog({ day, onClose }: { day: { userId: string; name: string; date: string } | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['team', 'day', day?.userId, day?.date],
    queryFn: () => api.get<AttendanceDayDetail>(`/team/members/${day!.userId}/day/${day!.date}`),
    enabled: !!day,
    refetchInterval: (query) => (isAddressPending(query.state.data?.punches) ? 4000 : false),
  });
  const r = q.data?.record;
  return (
    <Dialog open={!!day} onClose={onClose} title={day ? `${day.name} — ${formatDate(day.date)}` : ''}>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <DefinitionList
            items={[
              { label: 'Status', value: <StatusBadge status={r?.status} /> },
              { label: 'First in', value: formatTime(r?.clockIn, q.data?.timezone) },
              { label: 'Last out', value: formatTime(r?.clockOut, q.data?.timezone) },
              { label: 'Worked', value: formatDuration(r?.workMinutes) },
            ]}
          />
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Clock-in / clock-out locations</p>
            <PunchTimeline punches={q.data?.punches ?? []} office={q.data?.office ?? null} timezone={q.data?.timezone} mapOpenByDefault />
          </div>
        </div>
      )}
    </Dialog>
  );
}
