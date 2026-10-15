import { PERMISSIONS } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Banner, Card, EmptyState, ErrorState, PageHeader } from '../../components/ui/Display';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Input, Select, Toggle } from '../../components/ui/Field';
import { DataTable, Tabs, type Column } from '../../components/ui/Data';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toOptions, useLookups } from '../shared';

type Kind = 'business-units' | 'departments' | 'designations' | 'grades';

interface OrgRow {
  id: string;
  name: string;
  isActive: boolean;
  code?: string | null;
  rank?: number | null;
  businessUnitId?: string | null;
  businessUnit?: { id: string; name: string } | null;
  _count?: { users: number };
}

interface FormState {
  name: string;
  code: string;
  rank: string;
  businessUnitId: string;
  isActive: boolean;
}

interface KindConfig {
  label: string;
  singular: string;
  description: string;
  extra?: { header: string; cell: (r: OrgRow) => string | null };
  /** Business units have no employee count in the list response. */
  showCount: boolean;
}

const KINDS: Record<Kind, KindConfig> = {
  'business-units': {
    label: 'Business units',
    singular: 'business unit',
    description: 'Top-level divisions of the company, e.g. Sales or Engineering.',
    extra: { header: 'Code', cell: (r) => r.code ?? null },
    showCount: false,
  },
  departments: {
    label: 'Departments',
    singular: 'department',
    description: 'Teams within a business unit.',
    extra: { header: 'Business unit', cell: (r) => r.businessUnit?.name ?? null },
    showCount: true,
  },
  designations: {
    label: 'Designations',
    singular: 'designation',
    description: 'Job titles, e.g. Software Engineer.',
    showCount: true,
  },
  grades: {
    label: 'Grades',
    singular: 'grade',
    description: 'Pay bands or levels. Lower rank = more junior.',
    extra: { header: 'Rank', cell: (r) => (r.rank ?? null) === null ? null : String(r.rank) },
    showCount: true,
  },
};

const ORDER: Kind[] = ['business-units', 'departments', 'designations', 'grades'];

export default function OrganizationPage() {
  const [tab, setTab] = useState<Kind>('business-units');
  return (
    <div>
      <PageHeader title="Organization" description="Business units, departments, designations and grades used across employee profiles and policy rules." />
      <Card>
        <div className="px-4 pt-1 sm:px-5">
          <Tabs<Kind> value={tab} onChange={setTab} tabs={ORDER.map((k) => ({ value: k, label: KINDS[k].label }))} />
        </div>
        <EntityTab key={tab} kind={tab} />
      </Card>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function EntityTab({ kind }: { kind: Kind }) {
  const cfg = KINDS[kind];
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OrgRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OrgRow | null>(null);
  const q = useQuery({ queryKey: ['setup', kind], queryFn: () => api.get<OrgRow[]>(`/admin/setup/${kind}`) });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/setup/${kind}/${id}`),
    onSuccess: () => {
      toast.success(`${capitalize(cfg.singular)} deleted`);
      qc.invalidateQueries({ queryKey: ['setup', kind] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      setDeleting(null);
    },
    onError: (err) => {
      toast.error('Could not delete', errorMessage(err));
      setDeleting(null);
    },
  });

  const actions = (r: OrgRow) =>
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

  const columns: Column<OrgRow>[] = [
    { key: 'name', header: 'Name', cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    ...(cfg.extra ? [{ key: 'extra', header: cfg.extra.header, cell: (r: OrgRow) => cfg.extra!.cell(r) ?? <span className="text-slate-400">—</span> }] : []),
    ...(cfg.showCount ? [{ key: 'count', header: 'Employees', cell: (r: OrgRow) => <span className="tabular-nums">{r._count?.users ?? 0}</span> }] : []),
    { key: 'status', header: 'Status', cell: (r) => <ActiveBadge active={r.isActive} /> },
    ...(canEdit ? [{ key: 'actions', header: <span className="sr-only">Actions</span>, cell: actions, className: 'w-24 text-right' }] : []),
  ];

  return (
    <>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-sm text-slate-500">{cfg.description}</p>
        {canEdit && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add {cfg.singular}
          </Button>
        )}
      </div>
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
              icon={<Building2 className="size-6" />}
              title={`No ${cfg.label.toLowerCase()} yet`}
              description={canEdit ? `Add your first ${cfg.singular} to start organising employees.` : undefined}
            />
          }
          mobile={(r) => {
            const extra = cfg.extra?.cell(r);
            return (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {r.name}
                    <ActiveBadge active={r.isActive} />
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {[extra && `${cfg.extra!.header}: ${extra}`, cfg.showCount && `${r._count?.users ?? 0} employees`].filter(Boolean).join(' · ') || ' '}
                  </p>
                </div>
                {actions(r)}
              </div>
            );
          }}
        />
      )}

      <EntityDialog kind={kind} row={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        tone="danger"
        title={`Delete ${cfg.singular}?`}
        message={
          <>
            <span className="font-medium text-slate-900">{deleting?.name}</span> will be removed permanently. If employees still use it, mark it inactive instead.
          </>
        }
        confirmLabel="Delete"
      />
    </>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>;
}

const toForm = (r: OrgRow | null): FormState => ({
  name: r?.name ?? '',
  code: r?.code ?? '',
  rank: r?.rank === null || r?.rank === undefined ? '' : String(r.rank),
  businessUnitId: r?.businessUnitId ?? r?.businessUnit?.id ?? '',
  isActive: r?.isActive ?? true,
});

function toPayload(kind: Kind, f: FormState) {
  const base = { name: f.name.trim(), isActive: f.isActive };
  if (kind === 'business-units') return { ...base, code: f.code.trim() || null };
  if (kind === 'departments') return { ...base, businessUnitId: f.businessUnitId || null };
  if (kind === 'grades') return { ...base, rank: f.rank === '' ? null : Number(f.rank) };
  return base;
}

function EntityDialog({ kind, row, onClose }: { kind: Kind; row: OrgRow | 'new' | null; onClose: () => void }) {
  const cfg = KINDS[kind];
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = row && row !== 'new' ? row : null;
  const [form, setForm] = useState<FormState>(toForm(null));
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<OrgRow | 'new' | null>(null);

  // Reset the form whenever the dialog opens for a different row.
  if (row !== openedFor) {
    setOpenedFor(row);
    setForm(toForm(existing));
    setError(null);
  }

  const save = useMutation({
    mutationFn: () => {
      const body = toPayload(kind, form);
      return existing ? api.put(`/admin/setup/${kind}/${existing.id}`, body) : api.post(`/admin/setup/${kind}`, body);
    },
    onSuccess: () => {
      toast.success(existing ? `${capitalize(cfg.singular)} updated` : `${capitalize(cfg.singular)} added`);
      qc.invalidateQueries({ queryKey: ['setup', kind] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  const formId = `org-${kind}-form`;

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      title={existing ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={!form.name.trim()}>
            {existing ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <Input label="Name" required maxLength={100} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-autofocus />
        {kind === 'business-units' && (
          <Input label="Code" maxLength={20} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} hint="Optional short code, e.g. ENG." />
        )}
        {kind === 'departments' && (
          <Select
            label="Business unit"
            placeholder="None"
            options={toOptions(lookups.data?.businessUnits)}
            value={form.businessUnitId}
            onChange={(e) => setForm((f) => ({ ...f, businessUnitId: e.target.value }))}
          />
        )}
        {kind === 'grades' && (
          <Input
            label="Rank"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={form.rank}
            onChange={(e) => setForm((f) => ({ ...f, rank: e.target.value }))}
            hint="Optional. Used for sorting; lower numbers are more junior."
          />
        )}
        <Toggle
          label="Active"
          description="Inactive items stay on existing employees but can't be picked for new ones."
          checked={form.isActive}
          onChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
        />
      </form>
    </Dialog>
  );
}
