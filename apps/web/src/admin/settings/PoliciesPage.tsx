import { EMPTY_APPLIES_TO, PERMISSIONS, WEEKDAYS, type AppliesTo } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Banner, Card, CardHeader, EmptyState, ErrorState, PageHeader } from '../../components/ui/Display';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Input, Textarea, Toggle } from '../../components/ui/Field';
import { DataTable, type Column } from '../../components/ui/Data';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AppliesToEditor, AppliesToSummary } from '../shared';

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  fullDayMinutes: number;
  halfDayMinutes: number;
  absentBelowMinutes: number;
  weeklyOffs: number[];
  regularizationWindowDays: number;
  maxRegularizationsPerMonth: number;
  missedPunchCloseHours: number;
  appliesTo: AppliesTo | null;
  priority: number;
  isDefault: boolean;
  isActive: boolean;
}

interface FormState {
  name: string;
  description: string;
  fullDayHours: string;
  halfDayHours: string;
  absentBelowHours: string;
  weeklyOffs: number[];
  regularizationWindowDays: string;
  maxRegularizationsPerMonth: string;
  missedPunchCloseHours: string;
  appliesTo: AppliesTo;
  priority: string;
  isDefault: boolean;
  isActive: boolean;
}

const toHours = (min: number) => String(Math.round((min / 60) * 100) / 100);
const toMinutes = (hours: string) => Math.round(Number(hours) * 60);

/** "8h", "4h 30m" */
const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? (h ? `${h}h ${m}m` : `${m}m`) : `${h}h`;
};

const dayNames = (days: number[]) =>
  days.length === 0
    ? 'None'
    : WEEKDAYS.filter((d) => days.includes(d.value))
        .map((d) => d.short)
        .join(', ');

const toForm = (r: PolicyRow | null): FormState => ({
  name: r?.name ?? '',
  description: r?.description ?? '',
  fullDayHours: toHours(r?.fullDayMinutes ?? 480),
  halfDayHours: toHours(r?.halfDayMinutes ?? 270),
  absentBelowHours: toHours(r?.absentBelowMinutes ?? 120),
  weeklyOffs: r?.weeklyOffs ?? [6, 7],
  regularizationWindowDays: String(r?.regularizationWindowDays ?? 30),
  maxRegularizationsPerMonth: String(r?.maxRegularizationsPerMonth ?? 5),
  missedPunchCloseHours: String(r?.missedPunchCloseHours ?? 4),
  appliesTo: { ...EMPTY_APPLIES_TO, ...(r?.appliesTo ?? {}) },
  priority: String(r?.priority ?? 0),
  isDefault: r?.isDefault ?? false,
  isActive: r?.isActive ?? true,
});

export default function PoliciesPage() {
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PolicyRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PolicyRow | null>(null);
  const q = useQuery({ queryKey: ['setup', 'attendance-policies'], queryFn: () => api.get<PolicyRow[]>('/admin/setup/attendance-policies') });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/setup/attendance-policies/${id}`),
    onSuccess: () => {
      toast.success('Policy deleted');
      qc.invalidateQueries({ queryKey: ['setup', 'attendance-policies'] });
      setDeleting(null);
    },
    onError: (err) => {
      toast.error('Could not delete', errorMessage(err));
      setDeleting(null);
    },
  });

  const actions = (r: PolicyRow) =>
    canEdit && (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label={`Delete ${r.name}`} onClick={() => setDeleting(r)} className="hover:bg-red-50 hover:text-red-600">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    );

  const badges = (r: PolicyRow) => (
    <>
      {r.isDefault && <Badge tone="brand">Default</Badge>}
      {!r.isActive && <Badge>Inactive</Badge>}
    </>
  );

  const columns: Column<PolicyRow>[] = [
    {
      key: 'name',
      header: 'Policy',
      cell: (r) => (
        <div className="min-w-40">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900">{r.name}</span>
            {badges(r)}
          </div>
          {r.description && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{r.description}</p>}
        </div>
      ),
    },
    {
      key: 'thresholds',
      header: 'Full / Half / Absent',
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {hm(r.fullDayMinutes)} / {hm(r.halfDayMinutes)} / &lt;{hm(r.absentBelowMinutes)}
        </span>
      ),
    },
    { key: 'offs', header: 'Weekly offs', cell: (r) => dayNames(r.weeklyOffs) },
    {
      key: 'corrections',
      header: 'Corrections',
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.regularizationWindowDays}d window · {r.maxRegularizationsPerMonth === 0 ? 'unlimited' : `${r.maxRegularizationsPerMonth}/mo`}
        </span>
      ),
    },
    { key: 'applies', header: 'Applies to', cell: (r) => <AppliesToSummary value={r.appliesTo} /> },
    { key: 'priority', header: 'Priority', cell: (r) => <span className="tabular-nums">{r.priority}</span>, className: 'text-right' },
    ...(canEdit ? [{ key: 'actions', header: <span className="sr-only">Actions</span>, cell: actions, className: 'w-24 text-right' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Attendance policies"
        description="How worked hours become Present, Half Day or Absent, weekly offs, and correction limits. The most specific matching policy applies to each employee."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add policy
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="min-w-0">
          {q.isError ? (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : (
            <DataTable
              rows={q.data}
              loading={q.isLoading}
              columns={columns}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={<ClipboardList className="size-6" />}
                  title="No attendance policies yet"
                  description="Create a default policy so every day can be marked correctly."
                  action={
                    canEdit && (
                      <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                        Add policy
                      </Button>
                    )
                  }
                />
              }
              mobile={(r) => (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-900">{r.name}</span>
                      {badges(r)}
                    </div>
                    <p className="text-sm text-slate-600">
                      Full {hm(r.fullDayMinutes)} · Half {hm(r.halfDayMinutes)} · Absent &lt;{hm(r.absentBelowMinutes)}
                    </p>
                    <p className="text-xs text-slate-500">Offs: {dayNames(r.weeklyOffs)}</p>
                    <AppliesToSummary value={r.appliesTo} />
                  </div>
                  {actions(r)}
                </div>
              )}
            />
          )}
        </Card>
        <StatusHelp />
      </div>

      <PolicyDialog row={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        tone="danger"
        title="Delete policy?"
        message={
          <>
            <span className="font-medium text-slate-900">{deleting?.name}</span> will be removed permanently. Employees it covered will fall back to another matching policy.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function StatusHelp() {
  const rows: { tone: string; label: string; rule: string }[] = [
    { tone: 'red', label: 'Absent', rule: 'Worked less than the absent threshold.' },
    { tone: 'orange', label: 'Half Day', rule: 'Worked less than the half-day threshold.' },
    { tone: 'amber', label: 'Late', rule: 'Clocked in after shift start + grace.' },
    { tone: 'yellow', label: 'Early Out', rule: 'Left before shift end (minus early-out grace).' },
    { tone: 'green', label: 'Present', rule: 'Otherwise.' },
  ];
  return (
    <Card className="self-start">
      <CardHeader title="How statuses are decided" description="Checked in this order for each working day." />
      <ol className="space-y-2.5 px-4 py-3 text-sm sm:px-5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2">
            <Badge tone={r.tone} className="mt-px w-20 justify-center">
              {r.label}
            </Badge>
            <span className="text-slate-600">{r.rule}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PolicyDialog({ row, onClose }: { row: PolicyRow | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const existing = row && row !== 'new' ? row : null;
  const [form, setForm] = useState<FormState>(toForm(null));
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<PolicyRow | 'new' | null>(null);

  if (row !== openedFor) {
    setOpenedFor(row);
    setForm(toForm(existing));
    setError(null);
  }

  type TextKey = Exclude<keyof FormState, 'weeklyOffs' | 'appliesTo' | 'isDefault' | 'isActive'>;
  const set = (k: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, weeklyOffs: f.weeklyOffs.includes(d) ? f.weeklyOffs.filter((x) => x !== d) : [...f.weeklyOffs, d].sort((a, b) => a - b) }));

  const full = toMinutes(form.fullDayHours);
  const half = toMinutes(form.halfDayHours);
  const absent = toMinutes(form.absentBelowHours);
  const orderError = absent > half || half > full ? 'Thresholds must satisfy: absent ≤ half day ≤ full day.' : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        fullDayMinutes: full,
        halfDayMinutes: half,
        absentBelowMinutes: absent,
        weeklyOffs: form.weeklyOffs,
        regularizationWindowDays: Number(form.regularizationWindowDays),
        maxRegularizationsPerMonth: Number(form.maxRegularizationsPerMonth),
        missedPunchCloseHours: Number(form.missedPunchCloseHours),
        appliesTo: form.appliesTo,
        priority: Number(form.priority) || 0,
        isDefault: form.isDefault,
        isActive: form.isActive,
      };
      return existing ? api.put(`/admin/setup/attendance-policies/${existing.id}`, body) : api.post('/admin/setup/attendance-policies', body);
    },
    onSuccess: () => {
      toast.success(existing ? 'Policy updated' : 'Policy added');
      qc.invalidateQueries({ queryKey: ['setup', 'attendance-policies'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (orderError) return setError(orderError);
    save.mutate();
  };

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit attendance policy' : 'Add attendance policy'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="policy-form" loading={save.isPending} disabled={!form.name.trim()}>
            {existing ? 'Save changes' : 'Add policy'}
          </Button>
        </>
      }
    >
      <form id="policy-form" onSubmit={submit} className="space-y-5">
        {error && <Banner tone="error">{error}</Banner>}
        <div className="space-y-4">
          <Input label="Name" required maxLength={100} value={form.name} onChange={set('name')} placeholder="e.g. Standard 5-day week" data-autofocus />
          <Textarea label="Description" rows={2} maxLength={300} value={form.description} onChange={set('description')} />
        </div>

        <section aria-labelledby="policy-hours" className="space-y-3">
          <div>
            <h3 id="policy-hours" className="text-sm font-medium text-slate-800">
              Worked hours
            </h3>
            <p className="text-xs text-slate-500">Net hours worked in a day (after breaks) decide the day's status.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Full day (hours)" type="number" inputMode="decimal" step={0.25} min={1} max={24} required value={form.fullDayHours} onChange={set('fullDayHours')} hint={`= ${full || 0} min`} />
            <Input
              label="Half day below (hours)"
              type="number"
              inputMode="decimal"
              step={0.25}
              min={0.5}
              max={24}
              required
              value={form.halfDayHours}
              onChange={set('halfDayHours')}
              error={orderError && half > full ? 'Must be ≤ full day' : undefined}
              hint="Less than this is a Half Day."
            />
            <Input
              label="Absent below (hours)"
              type="number"
              inputMode="decimal"
              step={0.25}
              min={0}
              max={24}
              required
              value={form.absentBelowHours}
              onChange={set('absentBelowHours')}
              error={orderError && absent > half ? 'Must be ≤ half day' : undefined}
              hint="Less than this is Absent."
            />
          </div>
        </section>

        <section aria-labelledby="policy-offs" className="space-y-2">
          <h3 id="policy-offs" className="text-sm font-medium text-slate-800">
            Weekly offs
          </h3>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="policy-offs">
            {WEEKDAYS.map((d) => {
              const on = form.weeklyOffs.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.label}
                  onClick={() => toggleDay(d.value)}
                  className={clsx(
                    'h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Selected days are non-working days ({dayNames(form.weeklyOffs)}).</p>
        </section>

        <section aria-labelledby="policy-corrections" className="space-y-3">
          <h3 id="policy-corrections" className="text-sm font-medium text-slate-800">
            Corrections &amp; missed punches
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Correction window (days)"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              required
              value={form.regularizationWindowDays}
              onChange={set('regularizationWindowDays')}
              hint="How far back employees can request a correction."
            />
            <Input
              label="Max corrections / month"
              type="number"
              inputMode="numeric"
              min={0}
              max={31}
              required
              value={form.maxRegularizationsPerMonth}
              onChange={set('maxRegularizationsPerMonth')}
              hint="0 = unlimited."
            />
            <Input
              label="Missed punch close (hours)"
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              required
              value={form.missedPunchCloseHours}
              onChange={set('missedPunchCloseHours')}
              hint="The day is closed (missed punch or absent marked) this long after shift end."
            />
          </div>
        </section>

        <AppliesToEditor value={form.appliesTo} onChange={(appliesTo) => setForm((f) => ({ ...f, appliesTo }))} />

        <Input
          label="Priority"
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          value={form.priority}
          onChange={set('priority')}
          hint="Breaks ties when two policies match equally. Higher wins."
          className="sm:max-w-48"
        />
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <Toggle label="Default policy" description="Used when no other policy matches. Only one policy can be the default." checked={form.isDefault} onChange={(isDefault) => setForm((f) => ({ ...f, isDefault }))} />
          <Toggle label="Active" description="Inactive policies are ignored when matching employees." checked={form.isActive} onChange={(isActive) => setForm((f) => ({ ...f, isActive }))} />
        </div>
      </form>
    </Dialog>
  );
}
