import { ATTENDANCE_STATUSES, FLAG_LABELS, PERMISSIONS, STATUS_META, type AttendanceDay, type AttendanceDayDetail, type AttendanceStatus, type Paginated } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, PencilLine, Plus, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { isAddressPending, PlaceLink } from '../components/PlaceLink';
import { PunchTimeline } from '../components/PunchTimeline';
import { Badge, Banner, Card, DefinitionList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../components/ui/Display';
import { DataTable, Pagination, Tabs, type Column } from '../components/ui/Data';
import { Dialog } from '../components/ui/Dialog';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDuration, formatTime, todayKey } from '../lib/format';
import { toOptions, useLookups } from './shared';

interface AdminRecord extends AttendanceDay {
  user: { id: string; name: string; employeeCode: string; department: string | null; location: string | null };
  timezone: string;
  statusOverride: AttendanceStatus | null;
  overrideReason: string | null;
  reviewComment: string | null;
}

const monthStart = () => `${todayKey().slice(0, 7)}-01`;
const threeMonthsAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
};

/** HH:mm of an instant in a timezone (for prefilling override forms). */
const hhmm = (iso: string | null, tz: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso)) : '';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function AttendanceRecordsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'flagged' ? 'flagged' : 'all';
  const [filters, setFilters] = useState({ from: monthStart(), to: todayKey(), q: '', departmentId: '', locationId: '', status: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminRecord | null>(null);
  const [manual, setManual] = useState(false);
  const { data: lookups } = useLookups();
  const q = useDebounced(filters.q);

  // The review queue looks back over the last 3 months (the API's maximum range).
  const query = new URLSearchParams({
    from: tab === 'flagged' ? threeMonthsAgo() : filters.from,
    to: tab === 'flagged' ? todayKey() : filters.to,
    page: String(page),
    pageSize: '50',
  });
  if (tab === 'flagged') query.set('flagged', 'true');
  else if (filters.status) query.set('status', filters.status);
  if (q) query.set('q', q);
  if (filters.departmentId) query.set('departmentId', filters.departmentId);
  if (filters.locationId) query.set('locationId', filters.locationId);

  const list = useQuery({
    queryKey: ['admin-attendance', query.toString()],
    queryFn: () => api.get<Paginated<AdminRecord>>(`/admin/attendance?${query.toString()}`),
    placeholderData: (p) => p,
  });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };

  const columns: Column<AdminRecord>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.date)}</span> },
    {
      key: 'employee',
      header: 'Employee',
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.user.name}</p>
          <p className="text-xs text-slate-500">
            {r.user.employeeCode}
            {r.user.department ? ` · ${r.user.department}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'in', header: 'In', cell: (r) => <span className="tabular-nums">{formatTime(r.clockIn, r.timezone)}</span> },
    { key: 'out', header: 'Out', cell: (r) => <span className="tabular-nums">{formatTime(r.clockOut, r.timezone)}</span> },
    { key: 'hours', header: 'Worked', cell: (r) => <span className="tabular-nums">{formatDuration(r.workMinutes)}</span> },
    {
      key: 'place',
      header: 'Clock-in location',
      cell: (r) => (
        <div className="space-y-0.5 text-xs">
          <PlaceLink place={r.inPlace} compact />
          {r.outPlace && r.outPlace.mapUrl !== r.inPlace?.mapUrl && (
            <div className="flex items-center gap-1 text-slate-400">
              Out: <PlaceLink place={r.outPlace} compact />
            </div>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'flags',
      header: 'Flags',
      cell: (r) => (
        <div className="flex max-w-56 flex-wrap gap-1">
          {r.flags.map((f) => (
            <Badge key={f} tone={f.startsWith('OUTSIDE') ? 'fuchsia' : 'slate'}>
              {FLAG_LABELS[f] ?? f}
            </Badge>
          ))}
          {r.source !== 'APP' && <Badge tone="blue">{r.source === 'REGULARIZED' ? 'Corrected' : r.source === 'HR_OVERRIDE' ? 'HR edit' : 'System'}</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance records"
        description="Search punches, review flagged entries and correct attendance."
        actions={
          can(PERMISSIONS.ATTENDANCE_OVERRIDE) && (
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setManual(true)}>
              Manual entry
            </Button>
          )
        }
      />
      <Card>
        <div className="px-4 pt-1 sm:px-5">
          <Tabs
            value={tab}
            onChange={(v) => {
              setParams(v === 'flagged' ? { tab: 'flagged' } : {});
              setPage(1);
            }}
            tabs={[
              { value: 'all', label: 'All records' },
              { value: 'flagged', label: 'Needs review', count: tab === 'flagged' ? list.data?.total : undefined },
            ]}
          />
        </div>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6 sm:px-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.q}
              onChange={set('q')}
              placeholder="Search name or code"
              aria-label="Search employees"
              className="block h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          {tab === 'all' && (
            <>
              <Input type="date" aria-label="From" value={filters.from} max={filters.to} onChange={set('from')} />
              <Input type="date" aria-label="To" value={filters.to} min={filters.from} onChange={set('to')} />
            </>
          )}
          <Select aria-label="Department" value={filters.departmentId} onChange={set('departmentId')} options={toOptions(lookups?.departments, true)} placeholder="All departments" />
          {tab === 'all' ? (
            <Select
              aria-label="Status"
              value={filters.status}
              onChange={set('status')}
              options={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: `${s} · ${STATUS_META[s].label}` }))}
              placeholder="All statuses"
            />
          ) : (
            <Select aria-label="Location" value={filters.locationId} onChange={set('locationId')} options={toOptions(lookups?.locations, true)} placeholder="All locations" />
          )}
        </div>
        {list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : (
          <>
            <DataTable
              rows={list.data?.items}
              loading={list.isLoading}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={setOpen}
              empty={
                tab === 'flagged' ? (
                  <EmptyState icon={<AlertTriangle className="size-6" />} title="Nothing to review" description="Punches outside the office area or network appear here when restrictions are set to “Allow & flag”." />
                ) : (
                  <EmptyState icon={<CalendarCheck className="size-6" />} title="No records match these filters" />
                )
              }
              mobile={(r) => (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-slate-900">{r.user.name}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-sm text-slate-600">
                    {formatDate(r.date)} · {formatTime(r.clockIn, r.timezone)} – {formatTime(r.clockOut, r.timezone)} · {formatDuration(r.workMinutes)}
                  </p>
                  <PlaceLink place={r.inPlace} compact className="mt-0.5 text-xs" />
                  {r.flags.some((f) => f.startsWith('OUTSIDE')) && (
                    <p className="mt-0.5 text-xs text-fuchsia-700">{r.flags.filter((f) => f.startsWith('OUTSIDE')).map((f) => FLAG_LABELS[f]).join(' · ')}</p>
                  )}
                </div>
              )}
            />
            {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
          </>
        )}
      </Card>

      <RecordDialog record={open} onClose={() => setOpen(null)} />
      <ManualEntryDialog open={manual} onClose={() => setManual(false)} />
    </div>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-attendance'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

function RecordDialog({ record: r, onClose }: { record: AdminRecord | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const close = () => {
    setEditing(false);
    setComment('');
    onClose();
  };
  const review = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') => api.post(`/admin/attendance/${r!.id}/review`, { decision, comment: comment || undefined }),
    onSuccess: (_d, decision) => {
      toast.success(decision === 'APPROVE' ? 'Entry accepted' : 'Entry rejected (marked absent)');
      invalidate();
      close();
    },
    onError: (err) => toast.error('Could not save review', errorMessage(err)),
  });
  const canOverride = can(PERMISSIONS.ATTENDANCE_OVERRIDE);
  if (r && editing) return <OverrideDialog record={r} onClose={close} />;
  return (
    <Dialog
      open={!!r}
      onClose={close}
      title={r ? `${r.user.name} — ${formatDate(r.date)}` : ''}
      description={r ? `${r.user.employeeCode}${r.user.location ? ` · ${r.user.location}` : ''}` : undefined}
      footer={
        r &&
        canOverride && (
          <>
            <Button variant="secondary" icon={<PencilLine className="size-4" />} onClick={() => setEditing(true)}>
              Edit / override
            </Button>
            {r.reviewStatus === 'PENDING' && (
              <>
                <Button variant="danger" loading={review.isPending && review.variables === 'REJECT'} onClick={() => review.mutate('REJECT')}>
                  Reject entry
                </Button>
                <Button variant="success" loading={review.isPending && review.variables === 'APPROVE'} onClick={() => review.mutate('APPROVE')}>
                  Accept entry
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {r && (
        <div className="space-y-4">
          {r.reviewStatus === 'PENDING' && (
            <Banner tone="warning" title="Needs review">
              This punch was flagged by a restriction. Accept it to count the day normally, or reject it to mark the day absent.
            </Banner>
          )}
          <DefinitionList
            items={[
              { label: 'Status', value: <StatusBadge status={r.status} /> },
              { label: 'Clock in', value: formatTime(r.clockIn, r.timezone) },
              { label: 'Clock out', value: formatTime(r.clockOut, r.timezone) },
              { label: 'Worked', value: formatDuration(r.workMinutes) },
              { label: 'Late by', value: r.lateMinutes ? formatDuration(r.lateMinutes) : '—' },
              { label: 'Distance at clock-in', value: r.inDistanceMeters != null ? `${Math.round(r.inDistanceMeters)} m` : '—' },
              { label: 'Distance at clock-out', value: r.outDistanceMeters != null ? `${Math.round(r.outDistanceMeters)} m` : '—' },
              { label: 'Source', value: r.source },
              ...(r.overrideReason ? [{ label: 'HR note', value: r.overrideReason }] : []),
              ...(r.reviewComment ? [{ label: 'Review comment', value: r.reviewComment }] : []),
            ]}
          />
          {r.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {r.flags.map((f) => (
                <Badge key={f} tone={f.startsWith('OUTSIDE') ? 'fuchsia' : 'slate'}>
                  {FLAG_LABELS[f] ?? f}
                </Badge>
              ))}
            </div>
          )}
          <RecordActivity id={r.id} />
          {r.reviewStatus === 'PENDING' && canOverride && <Textarea label="Review comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />}
        </div>
      )}
    </Dialog>
  );
}

/** Punch log with map: where each clock-in / clock-out happened relative to the office geo-fence. */
function RecordActivity({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['admin-attendance', 'detail', id],
    queryFn: () => api.get<AttendanceDayDetail>(`/admin/attendance/${id}`),
    refetchInterval: (query) => (isAddressPending(query.state.data?.punches) ? 4000 : false),
  });
  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="mb-2 text-sm font-medium text-slate-700">Clock-in / clock-out activity</p>
      {q.isLoading ? <Skeleton className="h-24" /> : q.data ? <PunchTimeline punches={q.data.punches} office={q.data.office} timezone={q.data.timezone} mapOpenByDefault /> : null}
    </div>
  );
}

function OverrideDialog({ record: r, onClose }: { record: AdminRecord; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ clockIn: hhmm(r.clockIn, r.timezone), clockOut: hhmm(r.clockOut, r.timezone), statusOverride: r.statusOverride ?? '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.put(`/admin/attendance/${r.user.id}/${r.date}`, {
        clockIn: form.clockIn || null,
        clockOut: form.clockOut || null,
        statusOverride: form.statusOverride || null,
        reason: form.reason,
      }),
    onSuccess: () => {
      toast.success('Attendance updated', 'The employee has been notified.');
      invalidate();
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    m.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit attendance — ${r.user.name}`}
      description={`${formatDate(r.date)} · times in ${r.timezone}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="override" loading={m.isPending} disabled={form.reason.trim().length < 5}>
            Save changes
          </Button>
        </>
      }
    >
      <OverrideFields form={form} setForm={setForm} error={error} onSubmit={submit} />
    </Dialog>
  );
}

type OverrideForm = { clockIn: string; clockOut: string; statusOverride: string; reason: string };

function OverrideFields({ form, setForm, error, onSubmit, children }: { form: OverrideForm; setForm: React.Dispatch<React.SetStateAction<OverrideForm>>; error: string | null; onSubmit: (e: FormEvent) => void; children?: React.ReactNode }) {
  const set = (k: keyof OverrideForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form id="override" onSubmit={onSubmit} className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}
      {children}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Clock in" type="time" value={form.clockIn} onChange={set('clockIn')} />
        <Input label="Clock out" type="time" value={form.clockOut} onChange={set('clockOut')} />
      </div>
      <Select
        label="Force status (optional)"
        value={form.statusOverride}
        onChange={set('statusOverride')}
        options={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: `${STATUS_META[s].label} (${s})` }))}
        placeholder="Calculate automatically"
        hint="Leave on automatic unless the policy can’t express this case."
      />
      <Textarea label="Reason" required value={form.reason} onChange={set('reason')} hint="Recorded in the audit log and shown to the employee." />
    </form>
  );
}

function ManualEntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: lookups } = useLookups();
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(todayKey());
  const [form, setForm] = useState<OverrideForm>({ clockIn: '09:30', clockOut: '18:30', statusOverride: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.put(`/admin/attendance/${userId}/${date}`, { clockIn: form.clockIn || null, clockOut: form.clockOut || null, statusOverride: form.statusOverride || null, reason: form.reason }),
    onSuccess: () => {
      toast.success('Attendance saved');
      invalidate();
      setForm((f) => ({ ...f, reason: '' }));
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Manual attendance entry"
      description="Times are in the employee’s location timezone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="override" loading={m.isPending} disabled={!userId || form.reason.trim().length < 5}>
            Save entry
          </Button>
        </>
      }
    >
      <OverrideFields
        form={form}
        setForm={setForm}
        error={error}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          m.mutate();
        }}
      >
        <Select label="Employee" required value={userId} onChange={(e) => setUserId(e.target.value)} options={toOptions(lookups?.employees)} placeholder="Select employee" />
        <Input label="Date" type="date" required max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} />
      </OverrideFields>
    </Dialog>
  );
}
