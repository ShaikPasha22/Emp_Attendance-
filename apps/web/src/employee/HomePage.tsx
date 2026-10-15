import type { MonthAttendance, RequestDto } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CalendarDays, FileText, Home as HomeIcon, PartyPopper } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ClockCard, useToday } from '../components/ClockCard';
import { Card } from '../components/ui/Display';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDuration, greeting } from '../lib/format';

export default function HomePage() {
  const { user } = useAuth();
  const today = useToday();
  const t = today.data;
  const month = t?.date.slice(0, 7);
  const monthQuery = useQuery({
    queryKey: ['attendance', 'month', month],
    queryFn: () => api.get<MonthAttendance>(`/attendance/me?month=${month}`),
    enabled: !!month,
  });
  const pending = useQuery({ queryKey: ['requests', 'mine', 'PENDING'], queryFn: () => api.get<RequestDto[]>('/requests/me?status=PENDING') });
  const summary = monthQuery.data?.summary;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">{t ? formatDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' }) : ' '}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {greeting(t?.timezone)}, {user?.firstName}
        </h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ClockCard />
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">This month</h2>
              <Link to="/attendance" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                View calendar
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Present', value: (summary?.P ?? 0) + (summary?.L ?? 0) + (summary?.EO ?? 0) + (summary?.WFH ?? 0) + (summary?.OD ?? 0), tone: 'text-emerald-600' },
                { label: 'Late', value: summary?.L ?? 0, tone: 'text-amber-600' },
                { label: 'Absent', value: summary?.A ?? 0, tone: 'text-red-600' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className={clsx('text-2xl font-semibold tabular-nums', s.tone)}>{monthQuery.isLoading ? '–' : s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">Total worked: {formatDuration(summary?.workMinutes ?? 0)}</p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold text-slate-900">Quick actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction to="/requests/new?type=REGULARIZATION" icon={<FileText className="size-5" />} label="Fix attendance" />
              <QuickAction to="/requests/new?type=WFH" icon={<HomeIcon className="size-5" />} label="Work from home" />
              <QuickAction to="/requests/new?type=ON_DUTY" icon={<PartyPopper className="size-5" />} label="On duty" />
              <QuickAction to="/attendance" icon={<CalendarDays className="size-5" />} label="My calendar" />
            </div>
            {!!pending.data?.length && (
              <Link to="/requests" className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 hover:bg-amber-100">
                <span>
                  {pending.data.length} request{pending.data.length > 1 ? 's' : ''} awaiting approval
                </span>
                <span aria-hidden>→</span>
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-2 py-3 text-center text-sm font-medium text-slate-700 hover:border-brand-200 hover:bg-brand-50/50">
      <span className="text-brand-600">{icon}</span>
      {label}
    </Link>
  );
}
