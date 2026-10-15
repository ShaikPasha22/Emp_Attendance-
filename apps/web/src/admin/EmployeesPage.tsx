import { EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPES, PERMISSIONS, type EmployeeListItem, type Paginated, type UserStatus } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, Search, Upload, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { Avatar, Banner, Card, EmptyState, ErrorState, PageHeader, UserStatusBadge } from '../components/ui/Display';
import { DataTable, Pagination, Tabs, type Column } from '../components/ui/Data';
import { Dialog } from '../components/ui/Dialog';
import { Checkbox, Input, Select } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relativeTime } from '../lib/format';
import { toOptions, useLookups } from './shared';

type StatusTab = 'ALL' | UserStatus;

export default function EmployeesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusTab | null) ?? 'ALL';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data: lookups } = useLookups();
  const canManage = can(PERMISSIONS.EMPLOYEES_MANAGE);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, departmentId, status]);

  const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status !== 'ALL') qs.set('status', status);
  if (debounced) qs.set('q', debounced);
  if (departmentId) qs.set('departmentId', departmentId);
  const list = useQuery({
    queryKey: ['employees', qs.toString()],
    queryFn: () => api.get<Paginated<EmployeeListItem>>(`/admin/employees?${qs.toString()}`),
    placeholderData: (p) => p,
  });
  const pendingCount = useQuery({
    queryKey: ['employees', 'pending-count'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/admin/employees?status=PENDING&pageSize=1'),
  });

  const columns: Column<EmployeeListItem>[] = [
    {
      key: 'name',
      header: 'Employee',
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar name={e.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{e.name}</p>
            <p className="truncate text-xs text-slate-500">{e.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'code', header: 'Code', cell: (e) => <span className="tabular-nums">{e.employeeCode}</span> },
    {
      key: 'role',
      header: 'Department',
      cell: (e) => (
        <div>
          <p>{e.department ?? '—'}</p>
          <p className="text-xs text-slate-500">{e.designation ?? ''}</p>
        </div>
      ),
    },
    { key: 'location', header: 'Location', cell: (e) => e.location ?? '—' },
    { key: 'manager', header: 'Manager', cell: (e) => e.manager ?? '—' },
    { key: 'profile', header: 'Access', cell: (e) => <span className="text-xs">{e.profile}</span> },
    { key: 'status', header: 'Status', cell: (e) => (e.status === 'PENDING' && canManage ? <PendingActions employee={e} /> : <UserStatusBadge status={e.status} />) },
    { key: 'login', header: 'Last sign-in', cell: (e) => <span className="text-xs text-slate-500">{e.lastLoginAt ? relativeTime(e.lastLoginAt) : 'Never'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Employees & access"
        description="Invite employees, approve access requests and manage accounts."
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setBulkOpen(true)}>
                Bulk import
              </Button>
              <Button icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
                Invite employee
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="px-4 pt-1 sm:px-5">
          <Tabs<StatusTab>
            value={status}
            onChange={(v) => setParams(v === 'ALL' ? {} : { status: v })}
            tabs={[
              { value: 'ALL', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'PENDING', label: 'Access requests', count: pendingCount.data?.total },
              { value: 'INVITED', label: 'Invited' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'EXITED', label: 'Exited' },
            ]}
          />
        </div>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3 sm:px-5">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or code"
              aria-label="Search employees"
              className="block h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <Select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={toOptions(lookups?.departments, true)} placeholder="All departments" />
        </div>
        {list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : (
          <>
            <DataTable
              rows={list.data?.items}
              loading={list.isLoading}
              columns={columns}
              rowKey={(e) => e.id}
              onRowClick={(e) => navigate(`/admin/employees/${e.id}`)}
              empty={
                <EmptyState
                  icon={<Users className="size-6" />}
                  title={status === 'PENDING' ? 'No access requests' : 'No employees found'}
                  description={status === 'PENDING' ? 'When someone signs up, they will wait here for your approval.' : 'Try a different search, or invite your first employee.'}
                />
              }
              mobile={(e) => (
                <div className="flex items-center gap-3">
                  <Avatar name={e.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{e.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {e.employeeCode} · {e.department ?? 'No department'}
                    </p>
                  </div>
                  <span onClick={(ev) => ev.stopPropagation()}>{e.status === 'PENDING' && canManage ? <PendingActions employee={e} /> : <UserStatusBadge status={e.status} />}</span>
                </div>
              )}
            />
            {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
          </>
        )}
      </Card>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

function PendingActions({ employee }: { employee: EmployeeListItem }) {
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (action: 'APPROVE' | 'REJECT') => api.post(`/admin/employees/${employee.id}/status`, { action }),
    onSuccess: (_d, action) => {
      toast.success(action === 'APPROVE' ? `${employee.name} approved` : 'Request rejected', action === 'APPROVE' ? 'They can now sign in.' : undefined);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
    },
    onError: (err) => toast.error('Action failed', errorMessage(err)),
  });
  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="success" icon={<Check className="size-3.5" />} loading={m.isPending && m.variables === 'APPROVE'} onClick={() => m.mutate('APPROVE')}>
        Approve
      </Button>
      <Button size="sm" variant="secondary" aria-label="Reject" loading={m.isPending && m.variables === 'REJECT'} onClick={() => m.mutate('REJECT')}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

export function InviteLinkBox({ link, emailed }: { link: string; emailed: boolean }) {
  const toast = useToast();
  return (
    <div className="space-y-2">
      <Banner tone="success" title={emailed ? 'Invitation emailed' : 'Invitation created'}>
        {emailed ? 'You can also share this link directly:' : 'Email is not configured yet — share this link with the employee:'}
      </Banner>
      <div className="flex gap-2">
        <input readOnly value={link} aria-label="Invite link" className="block w-full truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="secondary"
          icon={<Copy className="size-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast.success('Link copied');
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

const emptyInvite = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  employeeCode: '',
  employeeType: 'PERMANENT',
  joiningDate: '',
  businessUnitId: '',
  departmentId: '',
  designationId: '',
  gradeId: '',
  locationId: '',
  managerId: '',
  profileId: '',
};

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [form, setForm] = useState(emptyInvite);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inviteLink: string; emailed: boolean } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => {
    setForm(emptyInvite);
    setResult(null);
    setError(null);
    onClose();
  };
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...form };
      for (const [k, v] of Object.entries(body)) if (v === '') body[k] = k === 'employeeCode' || k === 'phone' ? undefined : null;
      return api.post<{ inviteLink: string; emailed: boolean }>('/admin/employees', body);
    },
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
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
      open={open}
      onClose={close}
      title="Invite employee"
      description="They’ll get an email to set their password. Policies are assigned automatically from their location, department and type."
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={() => { setForm(emptyInvite); setResult(null); }}>
              Invite another
            </Button>
            <Button onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="invite" loading={m.isPending} disabled={!form.firstName || !form.lastName || !form.email}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <InviteLinkBox link={result.inviteLink} emailed={result.emailed} />
      ) : (
        <form id="invite" onSubmit={submit} className="space-y-5">
          {error && <Banner tone="error">{error}</Banner>}
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-800">Basic details</legend>
            <Input label="First name" required value={form.firstName} onChange={set('firstName')} />
            <Input label="Last name" required value={form.lastName} onChange={set('lastName')} />
            <Input label="Work email" type="email" required value={form.email} onChange={set('email')} />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
            <Input label="Employee code" value={form.employeeCode} onChange={set('employeeCode')} hint="Leave blank to auto-generate" />
            <Input label="Joining date" type="date" value={form.joiningDate} onChange={set('joiningDate')} />
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-800">Organization</legend>
            <Select label="Employee type" value={form.employeeType} onChange={set('employeeType')} options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABELS[t] }))} />
            <Select label="Location" value={form.locationId} onChange={set('locationId')} options={toOptions(lookups?.locations)} placeholder="—" />
            <Select label="Department" value={form.departmentId} onChange={set('departmentId')} options={toOptions(lookups?.departments)} placeholder="—" />
            <Select label="Designation" value={form.designationId} onChange={set('designationId')} options={toOptions(lookups?.designations)} placeholder="—" />
            <Select label="Business unit" value={form.businessUnitId} onChange={set('businessUnitId')} options={toOptions(lookups?.businessUnits)} placeholder="—" />
            <Select label="Grade" value={form.gradeId} onChange={set('gradeId')} options={toOptions(lookups?.grades)} placeholder="—" />
            <Select label="Reporting manager" value={form.managerId} onChange={set('managerId')} options={toOptions(lookups?.employees)} placeholder="—" />
            <Select
              label="Access profile"
              value={form.profileId}
              onChange={set('profileId')}
              options={(lookups?.profiles ?? []).map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Employee (default)"
            />
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}

const TEMPLATE_HEADERS = ['firstName', 'lastName', 'email', 'phone', 'employeeCode', 'employeeType', 'department', 'designation', 'location', 'managerEmail'];

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

interface BulkResult {
  created: number;
  failed: number;
  results: { row: number; email: string; ok: boolean; error?: string; inviteLink?: string }[];
}

function BulkImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [sendEmails, setSendEmails] = useState(true);
  const [result, setResult] = useState<BulkResult | null>(null);
  const close = () => {
    setRows([]);
    setResult(null);
    setParseError(null);
    onClose();
  };
  const onFile = async (file: File) => {
    setParseError(null);
    const [header, ...data] = parseCsv(await file.text());
    if (!header) return setParseError('The file is empty.');
    const keys = header.map((h) => h.trim());
    const missing = ['firstName', 'lastName', 'email'].filter((k) => !keys.includes(k));
    if (missing.length) return setParseError(`Missing required column(s): ${missing.join(', ')}. Download the template to see the format.`);
    if (data.length > 500) return setParseError('Please import at most 500 employees at a time.');
    setRows(data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()]))));
  };
  const m = useMutation({
    mutationFn: () =>
      api.post<BulkResult>('/admin/employees/bulk', {
        sendEmails,
        employees: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'employeeType' ? v.toUpperCase() : v]))),
      }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
    },
  });
  const downloadTemplate = () => {
    const sample = 'Asha,Rao,asha.rao@company.com,9876543210,,PERMANENT,Engineering,Software Engineer,Bengaluru HQ,manager@company.com';
    const blob = new Blob([`${TEMPLATE_HEADERS.join(',')}\n${sample}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employee-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Bulk import employees"
      description="Upload a CSV. Department, designation and location must match names already set up."
      size="lg"
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={m.isPending} disabled={!rows.length} onClick={() => m.mutate()}>
              Import {rows.length || ''} employee{rows.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Banner tone={result.failed ? 'warning' : 'success'} title={`${result.created} imported, ${result.failed} failed`} />
          {result.failed > 0 && (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 text-sm">
              {result.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.row} className="px-3 py-2">
                    <span className="font-medium">Row {r.row}</span> · {r.email}: <span className="text-red-600">{r.error}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" icon={<Download className="size-4" />} onClick={downloadTemplate}>
            Download CSV template
          </Button>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-400 hover:bg-brand-50/30">
            <Upload className="size-6 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">{rows.length ? `${rows.length} rows ready` : 'Choose a CSV file'}</span>
            <span className="text-xs text-slate-500">Required columns: firstName, lastName, email</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {parseError && <Banner tone="error">{parseError}</Banner>}
          {m.isError && <Banner tone="error">{errorMessage(m.error)}</Banner>}
          {rows.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 text-xs">
              <table className="min-w-full">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Email</th>
                    <th className="px-2 py-1.5">Department</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        {r.firstName} {r.lastName}
                      </td>
                      <td className="px-2 py-1.5">{r.email}</td>
                      <td className="px-2 py-1.5">{r.department || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && <p className="px-2 py-1.5 text-slate-500">…and {rows.length - 20} more</p>}
            </div>
          )}
          <Checkbox checked={sendEmails} onChange={setSendEmails} label="Email each employee their invitation" />
        </div>
      )}
    </Dialog>
  );
}
