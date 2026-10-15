import { FLAG_LABELS, PERMISSIONS, type LiveDashboard } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckSquare, Clock, Home, LogIn, UserPlus, Users, UserX } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile, StatusBadge } from '../components/ui/Display';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatTime } from '../lib/format';

export default function OverviewPage() {
  const { can, user } = useAuth();
  const allowed = can(PERMISSIONS.ATTENDANCE_VIEW);
  const q = useQuery({
    queryKey: ['dashboard', 'live'],
    queryFn: () => api.get<LiveDashboard>('/admin/dashboard/live'),
    enabled: allowed,
    refetchInterval: 60_000,
  });

  // Managers without HR permissions land on their approvals / team instead.
  if (!allowed) return <Navigate to={user?.hasReports ? '/admin/team' : '/admin/approvals'} replace />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const t = d?.totals;
  const pct = (n: number) => (t && t.active ? Math.round((n / t.active) * 100) : 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Today at a glance" description={d ? `${formatDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })} · refreshes every minute` : ' '} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!t ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <StatTile label="Clocked in" value={t.clockedIn} hint={`${pct(t.clockedIn)}% of ${t.active} active`} tone="green" icon={<LogIn className="size-4" />} />
            <StatTile label="Late today" value={t.late} hint={t.clockedIn ? `${Math.round((t.late / t.clockedIn) * 100)}% of arrivals` : 'No arrivals yet'} tone="amber" icon={<Clock className="size-4" />} />
            <StatTile label="Not in yet" value={t.notIn} hint={`${t.weeklyOff} on weekly off`} tone="red" icon={<UserX className="size-4" />} />
            <StatTile label="Remote (WFH / OD)" value={t.remote} hint="Approved for today" tone="teal" icon={<Home className="size-4" />} />
          </>
        )}
      </div>

      {t && (t.flagged > 0 || t.pendingApprovals > 0 || t.pendingAccess > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard to="/admin/attendance?tab=flagged" count={t.flagged} label="Flagged entries to review" icon={<AlertTriangle className="size-5" />} tone="text-fuchsia-600 bg-fuchsia-50" />
          <ActionCard to="/admin/approvals" count={t.pendingApprovals} label="Requests awaiting approval" icon={<CheckSquare className="size-5" />} tone="text-amber-600 bg-amber-50" />
          <ActionCard to="/admin/employees?status=PENDING" count={t.pendingAccess} label="Access requests" icon={<UserPlus className="size-5" />} tone="text-blue-600 bg-blue-50" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="By department" />
          <div className="space-y-4 p-4 sm:p-5">
            {!d ? (
              <Skeleton className="h-32" />
            ) : d.byDepartment.length === 0 ? (
              <p className="text-sm text-slate-500">No employees yet.</p>
            ) : (
              d.byDepartment.map((row) => {
                const present = row.total ? Math.round((row.present / row.total) * 100) : 0;
                return (
                  <div key={row.department}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-slate-700">{row.department}</span>
                      <span className="text-slate-500 tabular-nums">
                        {row.present}/{row.total} in{row.late ? ` · ${row.late} late` : ''}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={present} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.department} attendance`}>
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${present}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Latest punches"
            action={
              <Link to="/admin/attendance" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                All records
              </Link>
            }
          />
          {!d ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : d.recentPunches.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="No one has clocked in yet today" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentPunches.map((p) => (
                <li key={p.userId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {p.department ?? '—'} · In {formatTime(p.clockIn)}
                      {p.clockOut ? ` · Out ${formatTime(p.clockOut)}` : ''}
                      {p.flags.filter((f) => f.startsWith('OUTSIDE')).map((f) => ` · ${FLAG_LABELS[f]}`)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function ActionCard({ to, count, label, icon, tone }: { to: string; count: number; label: string; icon: React.ReactNode; tone: string }) {
  if (!count) return null;
  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-200">
      <span className={`rounded-xl p-2.5 ${tone}`}>{icon}</span>
      <div>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{count}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </Link>
  );
}
