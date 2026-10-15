import { EMPTY_APPLIES_TO, PERMISSIONS, type AppliesTo } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Moon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Banner, Card, EmptyState, ErrorState, PageHeader } from '../../components/ui/Display';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Input, Toggle } from '../../components/ui/Field';
import { DataTable, type Column } from '../../components/ui/Data';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AppliesToEditor, AppliesToSummary } from '../shared';

interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyOutGraceMinutes: number;
  breakMinutes: number;
  appliesTo: AppliesTo | null;
  priority: number;
  isDefault: boolean;
  isActive: boolean;
  _count?: { users: number };
}

interface FormState {
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: string;
  earlyOutGraceMinutes: string;
  breakMinutes: string;
  appliesTo: AppliesTo;
  priority: string;
  isDefault: boolean;
  isActive: boolean;
}

const toForm = (r: ShiftRow | null): FormState => ({
  name: r?.name ?? '',
  startTime: r?.startTime ?? '09:30',
  endTime: r?.endTime ?? '18:30',
  graceMinutes: String(r?.graceMinutes ?? 15),
  earlyOutGraceMinutes: String(r?.earlyOutGraceMinutes ?? 0),
  breakMinutes: String(r?.breakMinutes ?? 60),
  appliesTo: { ...EMPTY_APPLIES_TO, ...(r?.appliesTo ?? {}) },
  priority: String(r?.priority ?? 0),
  isDefault: r?.isDefault ?? false,
  isActive: r?.isActive ?? true,
});

const isOvernight = (start: string, end: string) => end < start;

/** Shift length minus break, e.g. "8h" or "7h 30m". */
function workHours(start: string, end: string, breakMin: number) {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  let span = toMin(end) - toMin(start);
  if (span <= 0) span += 24 * 60;
  const net = Math.max(0, span - breakMin);
  const h = Math.floor(net / 60);
  const m = net % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function ShiftsPage() {
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ShiftRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ShiftRow | null>(null);
  const q = useQuery({ queryKey: ['setup', 'shifts'], queryFn: () => api.get<ShiftRow[]>('/admin/setup/shifts') });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/setup/shifts/${id}`),
    onSuccess: () => {
      toast.success('Shift deleted');
      qc.invalidateQueries({ queryKey: ['setup', 'shifts'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      setDeleting(null);
    },
    onError: (err) => {
      toast.error('Could not delete', errorMessage(err));
      setDeleting(null);
    },
  });

  const actions = (r: ShiftRow) =>
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

  const badges = (r: ShiftRow) => (
    <>
      {r.isDefault && <Badge tone="brand">Default</Badge>}
      {isOvernight(r.startTime, r.endTime) && (
        <Badge tone="indigo">
          <Moon className="size-3" aria-hidden />
          Overnight
        </Badge>
      )}
      {!r.isActive && <Badge>Inactive</Badge>}
    </>
  );

  const columns: Column<ShiftRow>[] = [
    {
      key: 'name',
      header: 'Shift',
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-slate-900">{r.name}</span>
          {badges(r)}
        </div>
      ),
    },
    {
      key: 'timing',
      header: 'Timing',
      cell: (r) => (
        <div className="whitespace-nowrap">
          <span className="tabular-nums">
            {r.startTime} – {r.endTime}
          </span>
          <p className="text-xs text-slate-500">{workHours(r.startTime, r.endTime, r.breakMinutes)} work · {r.breakMinutes}m break</p>
        </div>
      ),
    },
    { key: 'grace', header: 'Grace', cell: (r) => <span className="tabular-nums">{r.graceMinutes} min</span> },
    { key: 'applies', header: 'Applies to', cell: (r) => <AppliesToSummary value={r.appliesTo} /> },
    { key: 'priority', header: 'Priority', cell: (r) => <span className="tabular-nums">{r.priority}</span>, className: 'text-right' },
    { key: 'assigned', header: 'Direct', cell: (r) => <span className="tabular-nums">{r._count?.users ?? 0}</span>, className: 'text-right' },
    { key: 'status', header: 'Status', cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
    ...(canEdit ? [{ key: 'actions', header: <span className="sr-only">Actions</span>, cell: actions, className: 'w-24 text-right' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Shifts"
        description="Working hours used to mark late arrivals and early exits. The most specific matching shift applies to each employee, unless HR assigns one directly on the employee's profile."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add shift
            </Button>
          )
        }
      />
      <Card>
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
                icon={<Clock className="size-6" />}
                title="No shifts yet"
                description="Create a default shift so everyone has working hours."
                action={
                  canEdit && (
                    <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                      Add shift
                    </Button>
                  )
                }
              />
            }
            mobile={(r) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-sm text-slate-600 tabular-nums">
                    {r.startTime} – {r.endTime} · {r.graceMinutes} min grace
                  </p>
                  <div className="flex flex-wrap gap-1">{badges(r)}</div>
                  <AppliesToSummary value={r.appliesTo} />
                </div>
                {actions(r)}
              </div>
            )}
          />
        )}
      </Card>

      <ShiftDialog row={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        tone="danger"
        title="Delete shift?"
        message={
          <>
            <span className="font-medium text-slate-900">{deleting?.name}</span> will be removed permanently. Employees matched by its rules will fall back to another shift.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function ShiftDialog({ row, onClose }: { row: ShiftRow | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const existing = row && row !== 'new' ? row : null;
  const [form, setForm] = useState<FormState>(toForm(null));
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<ShiftRow | 'new' | null>(null);

  if (row !== openedFor) {
    setOpenedFor(row);
    setForm(toForm(existing));
    setError(null);
  }

  const setText = (k: 'name' | 'startTime' | 'endTime' | 'graceMinutes' | 'earlyOutGraceMinutes' | 'breakMinutes' | 'priority') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        graceMinutes: Number(form.graceMinutes) || 0,
        earlyOutGraceMinutes: Number(form.earlyOutGraceMinutes) || 0,
        breakMinutes: Number(form.breakMinutes) || 0,
        appliesTo: form.appliesTo,
        priority: Number(form.priority) || 0,
        isDefault: form.isDefault,
        isActive: form.isActive,
      };
      return existing ? api.put(`/admin/setup/shifts/${existing.id}`, body) : api.post('/admin/setup/shifts', body);
    },
    onSuccess: () => {
      toast.success(existing ? 'Shift updated' : 'Shift added');
      qc.invalidateQueries({ queryKey: ['setup', 'shifts'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.startTime === form.endTime) return setError('Start and end time cannot be the same.');
    save.mutate();
  };

  const overnight = form.startTime && form.endTime && isOvernight(form.startTime, form.endTime);

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit shift' : 'Add shift'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="shift-form" loading={save.isPending} disabled={!form.name.trim() || !form.startTime || !form.endTime}>
            {existing ? 'Save changes' : 'Add shift'}
          </Button>
        </>
      }
    >
      <form id="shift-form" onSubmit={submit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <Input label="Name" required maxLength={100} value={form.name} onChange={setText('name')} placeholder="e.g. General shift" data-autofocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" required value={form.startTime} onChange={setText('startTime')} />
          <Input label="End time" type="time" required value={form.endTime} onChange={setText('endTime')} />
        </div>
        {form.startTime && form.endTime && form.startTime !== form.endTime && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {overnight && (
              <Badge tone="indigo">
                <Moon className="size-3" aria-hidden />
                Overnight
              </Badge>
            )}
            {workHours(form.startTime, form.endTime, Number(form.breakMinutes) || 0)} of work after break
            {overnight && ', ending the next day'}.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Late grace (min)"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            required
            value={form.graceMinutes}
            onChange={setText('graceMinutes')}
            hint="Clock-ins after start + grace are Late."
          />
          <Input
            label="Early-out grace (min)"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            required
            value={form.earlyOutGraceMinutes}
            onChange={setText('earlyOutGraceMinutes')}
            hint="Leaving earlier than this is Early Out."
          />
          <Input label="Break (min)" type="number" inputMode="numeric" min={0} max={240} required value={form.breakMinutes} onChange={setText('breakMinutes')} hint="Unpaid break in the shift." />
        </div>

        <AppliesToEditor value={form.appliesTo} onChange={(appliesTo) => setForm((f) => ({ ...f, appliesTo }))} />

        <Input
          label="Priority"
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          value={form.priority}
          onChange={setText('priority')}
          hint="Breaks ties when two shifts match an employee equally. Higher wins."
          className="sm:max-w-48"
        />
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <Toggle label="Default shift" description="Used when no other shift matches. Only one shift can be the default." checked={form.isDefault} onChange={(isDefault) => setForm((f) => ({ ...f, isDefault }))} />
          <Toggle label="Active" description="Inactive shifts are ignored when matching employees." checked={form.isActive} onChange={(isActive) => setForm((f) => ({ ...f, isActive }))} />
        </div>
      </form>
    </Dialog>
  );
}
