import {
  EMPLOYEE_TYPE_LABELS,
  EMPLOYEE_TYPES,
  PERMISSIONS,
  WEEKDAYS,
  type AttendanceDay,
  type AttendanceRestrictions,
  type AttendanceRestrictionsPatch,
  type EmployeeListItem,
  type Paginated,
  type ShiftInfo,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, LogOut, Mail, RotateCcw, Smartphone, UserX } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { Avatar, Badge, Banner, Card, CardHeader, DefinitionList, ErrorState, PageLoader, UserStatusBadge } from '../components/ui/Display';
import { Tabs } from '../components/ui/Data';
import { ConfirmDialog } from '../components/ui/Dialog';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { currentMonth, formatDateTime, relativeTime } from '../lib/format';
import { InviteLinkBox } from './EmployeesPage';
import { daysOfMonth, MonthGrid, StatusLegend, toCells } from './MonthGrid';
import { AttendanceRestrictionFields } from './restrictions';
import { MultiSelect, toOptions, useLookups } from './shared';

interface EmployeeDetail extends EmployeeListItem {
  firstName: string;
  lastName: string;
  phone: string | null;
  joiningDate: string | null;
  businessUnitId: string | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  locationId: string | null;
  shiftId: string | null;
  managerId: string | null;
  profileId: string;
  hrScopeBusinessUnitIds: string[];
  hrScopeLocationIds: string[];
  restrictionOverride: AttendanceRestrictionsPatch | null;
  restrictionOverrideReason: string | null;
  devices: { id: string; label: string | null; createdAt: string; lastUsedAt: string }[];
  activeSessions: number;
  reportsCount: number;
  invitePending: boolean;
  effective: {
    shift: ShiftInfo | null;
    policy: { fullDayMinutes: number; halfDayMinutes: number; weeklyOffs: number[] };
    restrictions: AttendanceRestrictions;
    inheritedRestrictions: AttendanceRestrictions;
    timezone: string;
    office: string | null;
  };
}

type Tab = 'profile' | 'attendance' | 'access';
type StatusAction = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE' | 'EXIT';

const ACTION_COPY: Record<StatusAction, { title: string; message: string; confirm: string; tone: 'danger' | 'primary' }> = {
  APPROVE: { title: 'Approve access?', message: 'They will be able to sign in and mark attendance.', confirm: 'Approve', tone: 'primary' },
  REJECT: { title: 'Reject this access request?', message: 'The sign-up will be removed. They can be invited later.', confirm: 'Reject', tone: 'danger' },
  SUSPEND: { title: 'Suspend this account?', message: 'They will be signed out everywhere and cannot sign in until reactivated.', confirm: 'Suspend', tone: 'danger' },
  REACTIVATE: { title: 'Reactivate this account?', message: 'They will be able to sign in again.', confirm: 'Reactivate', tone: 'primary' },
  EXIT: { title: 'Mark as exited?', message: 'Use this when the employee leaves. They are signed out and removed from active lists; history is kept.', confirm: 'Mark exited', tone: 'danger' },
};

export default function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  const [action, setAction] = useState<StatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [invite, setInvite] = useState<{ inviteLink: string; emailed: boolean } | null>(null);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<EmployeeDetail>(`/admin/employees/${id}`) });
  const canManage = can(PERMISSIONS.EMPLOYEES_MANAGE);
  const canSecurity = can(PERMISSIONS.SECURITY_MANAGE);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employee', id] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['lookups'] });
  };
  const statusM = useMutation({
    mutationFn: (a: StatusAction) => api.post(`/admin/employees/${id}/status`, { action: a, reason: reason || undefined }),
    onSuccess: (_d, a) => {
      toast.success('Account updated');
      setAction(null);
      setReason('');
      if (a === 'REJECT') navigate('/admin/employees?status=PENDING');
      else refresh();
    },
    onError: (err) => toast.error('Action failed', errorMessage(err)),
  });
  const simple = useMutation({
    mutationFn: (path: 'resend-invite' | 'reset-devices' | 'force-logout') => api.post<{ inviteLink?: string; emailed?: boolean; removed?: number; revoked?: number }>(`/admin/employees/${id}/${path}`),
    onSuccess: (res, path) => {
      if (path === 'resend-invite' && res.inviteLink) setInvite({ inviteLink: res.inviteLink, emailed: !!res.emailed });
      toast.success(path === 'resend-invite' ? 'Invitation re-sent' : path === 'reset-devices' ? `${res.removed ?? 0} device(s) reset` : `Signed out of ${res.revoked ?? 0} session(s)`);
      refresh();
    },
    onError: (err) => toast.error('Action failed', errorMessage(err)),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const e = q.data;
  const actions: StatusAction[] =
    e.status === 'PENDING' ? ['APPROVE', 'REJECT'] : e.status === 'ACTIVE' ? ['SUSPEND', 'EXIT'] : e.status === 'INVITED' ? ['SUSPEND', 'EXIT'] : ['REACTIVATE'];

  return (
    <div className="space-y-5">
      <Link to="/admin/employees" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Employees
      </Link>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <Avatar name={e.name} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
            {e.name} <UserStatusBadge status={e.status} />
          </h1>
          <p className="text-sm text-slate-500">
            {e.employeeCode} · {e.email}
            {e.designation ? ` · ${e.designation}` : ''}
          </p>
          <p className="text-xs text-slate-400">Last sign-in: {e.lastLoginAt ? relativeTime(e.lastLoginAt) : 'never'}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {e.status === 'INVITED' && (
              <Button variant="secondary" size="sm" icon={<Mail className="size-4" />} loading={simple.isPending && simple.variables === 'resend-invite'} onClick={() => simple.mutate('resend-invite')}>
                Resend invite
              </Button>
            )}
            {actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'APPROVE' || a === 'REACTIVATE' ? 'success' : 'secondary'}
                icon={a === 'APPROVE' || a === 'REACTIVATE' ? <CheckCircle2 className="size-4" /> : a === 'SUSPEND' ? <Ban className="size-4" /> : <UserX className="size-4" />}
                onClick={() => setAction(a)}
              >
                {ACTION_COPY[a].confirm}
              </Button>
            ))}
          </div>
        )}
      </Card>
      {invite && <InviteLinkBox link={invite.inviteLink} emailed={invite.emailed} />}
      {e.status === 'PENDING' && <Banner tone="warning" title="Access request">Check the details below, assign their department, location and manager, then approve.</Banner>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'attendance', label: 'Attendance' },
          { value: 'access', label: 'Access & restrictions' },
        ]}
      />
      {tab === 'profile' && <ProfileTab employee={e} canEdit={canManage} onSaved={refresh} />}
      {tab === 'attendance' && <AttendanceTab employee={e} />}
      {tab === 'access' && (
        <AccessTab employee={e} canManage={canManage} canSecurity={canSecurity} onSaved={refresh} onSimple={(p) => simple.mutate(p)} busy={simple.isPending ? simple.variables : undefined} />
      )}

      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={() => action && statusM.mutate(action)}
        loading={statusM.isPending}
        title={action ? ACTION_COPY[action].title : ''}
        message={action ? ACTION_COPY[action].message : ''}
        confirmLabel={action ? ACTION_COPY[action].confirm : ''}
        tone={action ? ACTION_COPY[action].tone : 'primary'}
      >
        {(action === 'SUSPEND' || action === 'EXIT' || action === 'REJECT') && <Textarea label="Reason (optional)" value={reason} onChange={(ev) => setReason(ev.target.value)} />}
      </ConfirmDialog>
    </div>
  );
}

function ProfileTab({ employee: e, canEdit, onSaved }: { employee: EmployeeDetail; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const initial = useMemo(
    () => ({
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      phone: e.phone ?? '',
      employeeCode: e.employeeCode,
      employeeType: e.employeeType,
      joiningDate: e.joiningDate ?? '',
      businessUnitId: e.businessUnitId ?? '',
      departmentId: e.departmentId ?? '',
      designationId: e.designationId ?? '',
      gradeId: e.gradeId ?? '',
      locationId: e.locationId ?? '',
      shiftId: e.shiftId ?? '',
      managerId: e.managerId ?? '',
    }),
    [e],
  );
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(initial), [initial]);
  const set = (k: keyof typeof form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: ev.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...form };
      for (const [k, v] of Object.entries(body)) if (v === '') body[k] = k === 'employeeCode' ? undefined : null;
      return api.put(`/admin/employees/${e.id}`, body);
    },
    onSuccess: () => {
      toast.success('Profile saved');
      onSaved();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    save.mutate();
  };
  const managers = toOptions(lookups?.employees).filter((o) => o.value !== e.id);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Details" />
        <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
          {error && <Banner tone="error">{error}</Banner>}
          <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
            <Input label="First name" required value={form.firstName} onChange={set('firstName')} />
            <Input label="Last name" required value={form.lastName} onChange={set('lastName')} />
            <Input label="Work email" type="email" required value={form.email} onChange={set('email')} />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
            <Input label="Employee code" value={form.employeeCode} onChange={set('employeeCode')} />
            <Input label="Joining date" type="date" value={form.joiningDate} onChange={set('joiningDate')} />
            <Select label="Employee type" value={form.employeeType} onChange={set('employeeType')} options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABELS[t] }))} />
            <Select label="Location" value={form.locationId} onChange={set('locationId')} options={toOptions(lookups?.locations, true)} placeholder="—" />
            <Select label="Department" value={form.departmentId} onChange={set('departmentId')} options={toOptions(lookups?.departments, true)} placeholder="—" />
            <Select label="Designation" value={form.designationId} onChange={set('designationId')} options={toOptions(lookups?.designations, true)} placeholder="—" />
            <Select label="Business unit" value={form.businessUnitId} onChange={set('businessUnitId')} options={toOptions(lookups?.businessUnits, true)} placeholder="—" />
            <Select label="Grade" value={form.gradeId} onChange={set('gradeId')} options={toOptions(lookups?.grades, true)} placeholder="—" />
            <Select label="Reporting manager" value={form.managerId} onChange={set('managerId')} options={managers} placeholder="—" />
            <Select
              label="Shift (direct assignment)"
              value={form.shiftId}
              onChange={set('shiftId')}
              options={toOptions(lookups?.shifts)}
              placeholder="Automatic (by rules)"
              hint="Leave on automatic to use the matching shift policy."
            />
          </fieldset>
          {canEdit && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={!dirty} onClick={() => setForm(initial)}>
                Discard
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          )}
        </form>
      </Card>

      <Card className="h-fit">
        <CardHeader title="What applies to them" description="Resolved from policies and overrides" />
        <div className="px-5 pb-3">
          <DefinitionList
            items={[
              { label: 'Shift', value: e.effective.shift ? `${e.effective.shift.name} (${e.effective.shift.startTime}–${e.effective.shift.endTime})` : 'None' },
              { label: 'Weekly offs', value: WEEKDAYS.filter((d) => e.effective.policy.weeklyOffs.includes(d.value)).map((d) => d.short).join(', ') || 'None' },
              { label: 'Office', value: e.effective.office ?? 'Not assigned' },
              { label: 'Geo-fence', value: e.effective.restrictions.geofenceMode },
              { label: 'Timezone', value: e.effective.timezone },
              { label: 'Direct reports', value: e.reportsCount },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

function AttendanceTab({ employee: e }: { employee: EmployeeDetail }) {
  const [month] = useState(currentMonth());
  const days = useMemo(() => daysOfMonth(month), [month]);
  const q = useQuery({
    queryKey: ['admin-attendance', 'employee', e.id, month],
    queryFn: () => api.get<Paginated<AttendanceDay>>(`/admin/attendance?userId=${e.id}&from=${days[0]}&to=${days[days.length - 1]}&pageSize=100`),
  });
  return (
    <Card>
      <CardHeader
        title="This month"
        action={
          <Link to={`/admin/attendance`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            All records
          </Link>
        }
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PageLoader />
      ) : (
        <>
          <MonthGrid days={days} rows={[{ id: e.id, name: e.name, sub: e.employeeCode, cells: toCells(days, q.data.items) }]} />
          <div className="border-t border-slate-100 px-4 py-3">
            <StatusLegend statuses={['P', 'L', 'HD', 'EO', 'A', 'WFH', 'OD', 'WO', 'MP', 'FL']} />
          </div>
        </>
      )}
    </Card>
  );
}

function AccessTab({
  employee: e,
  canManage,
  canSecurity,
  onSaved,
  onSimple,
  busy,
}: {
  employee: EmployeeDetail;
  canManage: boolean;
  canSecurity: boolean;
  onSaved: () => void;
  onSimple: (p: 'reset-devices' | 'force-logout') => void;
  busy?: string;
}) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [profileId, setProfileId] = useState(e.profileId);
  const [scopeBUs, setScopeBUs] = useState(e.hrScopeBusinessUnitIds);
  const [scopeLocs, setScopeLocs] = useState(e.hrScopeLocationIds);
  const [override, setOverride] = useState<AttendanceRestrictionsPatch>(e.restrictionOverride ?? {});
  const [overrideReason, setOverrideReason] = useState(e.restrictionOverrideReason ?? '');
  const profile = lookups?.profiles.find((p) => p.id === profileId);

  // Base for the override editor: what applies from company default + group rules, without this override.
  const inherited = e.effective.inheritedRestrictions;

  const saveAccess = useMutation({
    mutationFn: () => api.put(`/admin/employees/${e.id}`, { profileId, hrScopeBusinessUnitIds: scopeBUs, hrScopeLocationIds: scopeLocs }),
    onSuccess: () => {
      toast.success('Access updated');
      onSaved();
    },
    onError: (err) => toast.error('Could not update access', errorMessage(err)),
  });
  const saveOverride = useMutation({
    mutationFn: (clear: boolean) => api.put(`/admin/employees/${e.id}/restriction-override`, { settings: clear ? null : override, reason: overrideReason || undefined }),
    onSuccess: (_d, clear) => {
      toast.success(clear ? 'Override removed' : 'Override saved', 'Applies from their next clock-in.');
      if (clear) setOverride({});
      onSaved();
    },
    onError: (err) => toast.error('Could not save override', errorMessage(err)),
  });
  const accessDirty = profileId !== e.profileId || JSON.stringify(scopeBUs) !== JSON.stringify(e.hrScopeBusinessUnitIds) || JSON.stringify(scopeLocs) !== JSON.stringify(e.hrScopeLocationIds);
  const hasOverride = Object.keys(override).length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Dashboard access" description="What this person can do beyond marking their own attendance." />
          <div className="space-y-4 p-4 sm:p-5">
            <Select
              label="Access profile"
              value={profileId}
              onChange={(ev) => setProfileId(ev.target.value)}
              options={(lookups?.profiles ?? []).map((p) => ({ value: p.id, label: p.name }))}
              disabled={!canManage}
              hint="Managers automatically see their team and approvals — no profile needed."
            />
            {profile?.scope === 'ASSIGNED' && (
              <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-600">HR Business Partner scope — they only see employees in:</p>
                <MultiSelect label="Business units" options={toOptions(lookups?.businessUnits)} value={scopeBUs} onChange={setScopeBUs} placeholder="None" />
                <MultiSelect label="Locations" options={toOptions(lookups?.locations)} value={scopeLocs} onChange={setScopeLocs} placeholder="None" />
              </div>
            )}
            {canManage && (
              <div className="flex justify-end">
                <Button loading={saveAccess.isPending} disabled={!accessDirty} onClick={() => saveAccess.mutate()}>
                  Save access
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Devices & sessions" />
          <div className="space-y-4 p-4 sm:p-5">
            <p className="text-sm text-slate-600">
              {e.activeSessions} active session{e.activeSessions === 1 ? '' : 's'} · {e.devices.length} registered device{e.devices.length === 1 ? '' : 's'}
            </p>
            {e.devices.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {e.devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                    <Smartphone className="size-4 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <p className="truncate text-slate-700">{d.label ?? 'Unknown device'}</p>
                      <p className="text-xs text-slate-400">Registered {formatDateTime(d.createdAt)} · last used {relativeTime(d.lastUsedAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} disabled={!e.devices.length} loading={busy === 'reset-devices'} onClick={() => onSimple('reset-devices')}>
                Reset devices
              </Button>
              <Button variant="secondary" size="sm" icon={<LogOut className="size-4" />} disabled={!e.activeSessions} loading={busy === 'force-logout'} onClick={() => onSimple('force-logout')}>
                Sign out everywhere
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Individual restriction override {hasOverride && <Badge tone="amber">Active</Badge>}
            </span>
          }
          description="Make clock-in rules stricter or more relaxed for this person only (e.g. a field employee)."
        />
        <div className="px-4 sm:px-5">
          <AttendanceRestrictionFields value={override} onChange={setOverride} inherited={inherited} disabled={!canSecurity} />
        </div>
        {canSecurity && (
          <div className="space-y-3 border-t border-slate-100 p-4 sm:p-5">
            <Input label="Reason" value={overrideReason} onChange={(ev) => setOverrideReason(ev.target.value)} placeholder="e.g. Works at client sites" />
            <div className="flex justify-end gap-2">
              {e.restrictionOverride && (
                <Button variant="secondary" loading={saveOverride.isPending && saveOverride.variables === true} onClick={() => saveOverride.mutate(true)}>
                  Remove override
                </Button>
              )}
              <Button loading={saveOverride.isPending && saveOverride.variables === false} disabled={!hasOverride} onClick={() => saveOverride.mutate(false)}>
                Save override
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
