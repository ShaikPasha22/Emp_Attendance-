import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui/Display';
import { Input, Select } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, downloadFile, errorMessage } from '../lib/api';
import { currentMonth, formatMonth, shiftMonth, todayKey } from '../lib/format';
import { MonthGrid, StatusLegend } from './MonthGrid';
import { toOptions, useLookups } from './shared';

interface MusterRoll {
  month: string;
  days: { date: string; weekday: number }[];
  rows: {
    user: { id: string; employeeCode: string; name: string; department: string | null };
    cells: (AttendanceStatus | null)[];
    totals: Record<string, number>;
  }[];
}

export default function ReportsPage() {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [month, setMonth] = useState(currentMonth());
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [range, setRange] = useState({ from: `${todayKey().slice(0, 7)}-01`, to: todayKey() });
  const [downloading, setDownloading] = useState<string | null>(null);

  const filters = new URLSearchParams();
  if (departmentId) filters.set('departmentId', departmentId);
  if (locationId) filters.set('locationId', locationId);
  const muster = useQuery({
    queryKey: ['reports', 'muster', month, filters.toString()],
    queryFn: () => api.get<MusterRoll>(`/reports/muster-roll?month=${month}&${filters.toString()}`),
    placeholderData: (p) => p,
  });

  const download = async (key: string, path: string, name: string) => {
    setDownloading(key);
    try {
      await downloadFile(path, name);
    } catch (err) {
      toast.error('Download failed', errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  const totalsFor = (r: MusterRoll['rows'][number]) => ({
    present: (r.totals.P ?? 0) + (r.totals.L ?? 0) + (r.totals.EO ?? 0) + (r.totals.WFH ?? 0) + (r.totals.OD ?? 0),
    late: r.totals.L ?? 0,
    absent: r.totals.A ?? 0,
    hours: Math.round(((r.totals.workMinutes ?? 0) / 60) * 10) / 10,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Monthly muster roll and detailed attendance exports for payroll." />

      <Card>
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:px-5">
          <Select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={toOptions(lookups?.departments, true)} placeholder="All departments" />
          <Select aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={toOptions(lookups?.locations, true)} placeholder="All locations" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Muster roll"
          description="Every employee’s status for each day of the month."
          action={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<FileSpreadsheet className="size-4" />}
                loading={downloading === 'muster-xlsx'}
                onClick={() => download('muster-xlsx', `/reports/muster-roll?month=${month}&format=xlsx&${filters.toString()}`, `muster-roll-${month}.xlsx`)}
              >
                Excel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<FileText className="size-4" />}
                loading={downloading === 'muster-csv'}
                onClick={() => download('muster-csv', `/reports/muster-roll?month=${month}&format=csv&${filters.toString()}`, `muster-roll-${month}.csv`)}
              >
                CSV
              </Button>
            </div>
          }
        />
        <div className="flex items-center justify-between px-2 py-2 sm:px-4">
          <IconButton label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <span className="font-medium text-slate-800">{formatMonth(month)}</span>
          <IconButton label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonth()} className="disabled:opacity-30">
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
        {muster.isError ? (
          <ErrorState message={errorMessage(muster.error)} onRetry={() => muster.refetch()} />
        ) : !muster.data ? (
          <Skeleton className="m-4 h-48" />
        ) : muster.data.rows.length === 0 ? (
          <EmptyState title="No employees match these filters" />
        ) : (
          <>
            <MonthGrid
              days={muster.data.days.map((d) => d.date)}
              rows={muster.data.rows.map((r) => {
                const t = totalsFor(r);
                return { id: r.user.id, name: r.user.name, sub: `${r.user.employeeCode} · P ${t.present} · L ${t.late} · A ${t.absent} · ${t.hours}h`, cells: r.cells };
              })}
            />
            <div className="border-t border-slate-100 px-4 py-3">
              <StatusLegend statuses={[...ATTENDANCE_STATUSES]} />
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Detailed attendance export" description="One row per employee per day: punch times, hours, status, flags and distance from office (max 3 months)." />
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:px-5">
          <Input label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <Input label="To" type="date" value={range.to} min={range.from} max={todayKey()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          <div className="flex gap-2">
            <Button
              icon={<FileSpreadsheet className="size-4" />}
              loading={downloading === 'detail-xlsx'}
              onClick={() => download('detail-xlsx', `/reports/attendance?from=${range.from}&to=${range.to}&format=xlsx&${filters.toString()}`, `attendance-${range.from}.xlsx`)}
            >
              Download Excel
            </Button>
            <Button
              variant="secondary"
              loading={downloading === 'detail-csv'}
              onClick={() => download('detail-csv', `/reports/attendance?from=${range.from}&to=${range.to}&format=csv&${filters.toString()}`, `attendance-${range.from}.csv`)}
            >
              CSV
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
