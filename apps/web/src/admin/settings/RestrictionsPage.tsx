import {
  EMPTY_APPLIES_TO,
  type AppliesTo,
  type AttendanceRestrictions,
  type AttendanceRestrictionsPatch,
  type SecuritySettings,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, KeyRound, Lock, Plus, ShieldCheck, Smartphone, Timer, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge, Banner, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader } from '../../components/ui/Display';
import { Tabs } from '../../components/ui/Data';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Input, Segmented, Textarea, Toggle } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { AttendanceRestrictionFields } from '../restrictions';
import { AppliesToEditor, AppliesToSummary } from '../shared';

type Tab = 'login' | 'attendance' | 'policies';

interface RestrictionPolicy {
  id: string;
  name: string;
  description: string | null;
  settings: AttendanceRestrictionsPatch;
  appliesTo: AppliesTo;
  priority: number;
  isActive: boolean;
}

const splitList = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

export default function RestrictionsPage() {
  const [tab, setTab] = useState<Tab>('login');
  return (
    <div>
      <PageHeader
        title="Restrictions Center"
        description="Decide how strict sign-in and clock-in should be. Everything is off or lenient by default — switch on only what you need."
      />
      <div className="mb-5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'login', label: 'Login & account' },
            { value: 'attendance', label: 'Clock-in rules (company default)' },
            { value: 'policies', label: 'Rules by group' },
          ]}
        />
      </div>
      {tab === 'login' && <LoginSettings />}
      {tab === 'attendance' && <AttendanceDefaults />}
      {tab === 'policies' && <RestrictionPolicies />}
      <p className="mt-6 text-sm text-slate-500">
        <strong className="font-medium text-slate-700">How rules combine:</strong> company default → matching group rules (most specific wins) → individual employee override (set on the employee’s page). Every change is recorded in the audit log.
      </p>
    </div>
  );
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="safe-bottom sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
      <span className="text-sm text-slate-600">You have unsaved changes</span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onReset}>
          Discard
        </Button>
        <Button loading={saving} onClick={onSave}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-brand-600">{icon}</span>
            {title}
          </span>
        }
        description={description}
      />
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------- Login & account

function LoginSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'security'], queryFn: () => api.get<SecuritySettings>('/admin/settings/security') });
  const myIp = useQuery({ queryKey: ['settings', 'my-ip'], queryFn: () => api.get<{ ip: string }>('/admin/settings/my-ip') });
  const [form, setForm] = useState<SecuritySettings | null>(null);
  const [domains, setDomains] = useState('');
  const [ips, setIps] = useState('');
  useEffect(() => {
    if (q.data) {
      setForm(q.data);
      setDomains(q.data.allowedEmailDomains.join('\n'));
      setIps(q.data.dashboardIpAllowlist.join('\n'));
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: SecuritySettings) => api.put<SecuritySettings>('/admin/settings/security', body),
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'security'], data);
      qc.invalidateQueries({ queryKey: ['auth-config'] });
      toast.success('Login settings saved');
    },
    onError: (err) => toast.error('Could not save', errorMessage(err)),
  });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!form || !q.data) return <PageLoader />;
  const next: SecuritySettings = { ...form, allowedEmailDomains: splitList(domains), dashboardIpAllowlist: splitList(ips) };
  const dirty = JSON.stringify(next) !== JSON.stringify(q.data);
  const set = <K extends keyof SecuritySettings>(k: K, v: SecuritySettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: keyof SecuritySettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={<UserPlus className="size-4" />} title="Who can get an account">
          <Segmented
            label="Sign-up mode"
            value={form.signupMode}
            onChange={(v) => set('signupMode', v)}
            options={[
              { value: 'INVITE_AND_SIGNUP', label: 'Invite + self sign-up (HR approves)' },
              { value: 'INVITE_ONLY', label: 'Invite only' },
            ]}
          />
          <Textarea
            label="Allowed email domains"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="yourcompany.com"
            hint="One per line. Leave empty to allow any domain. Applies to sign-ups and invites."
          />
        </Section>

        <Section icon={<KeyRound className="size-4" />} title="Password policy">
          <Input label="Minimum length" type="number" min={8} max={64} className="max-w-40" value={form.passwordMinLength} onChange={num('passwordMinLength')} />
          <Toggle label="Require a number" checked={form.passwordRequireNumber} onChange={(v) => set('passwordRequireNumber', v)} />
          <Toggle label="Require an uppercase letter" checked={form.passwordRequireUppercase} onChange={(v) => set('passwordRequireUppercase', v)} />
          <Toggle label="Require a symbol" checked={form.passwordRequireSymbol} onChange={(v) => set('passwordRequireSymbol', v)} />
          <p className="text-xs text-slate-500">New rules apply the next time someone sets or changes a password.</p>
        </Section>

        <Section icon={<Lock className="size-4" />} title="Account lockout" description="Always on — protects against password guessing.">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Failed attempts allowed" type="number" min={3} max={20} value={form.lockoutMaxAttempts} onChange={num('lockoutMaxAttempts')} />
            <Input label="Lock duration (minutes)" type="number" min={1} max={1440} value={form.lockoutMinutes} onChange={num('lockoutMinutes')} />
          </div>
        </Section>

        <Section icon={<Timer className="size-4" />} title="Sessions">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Dashboard idle timeout (min)" type="number" min={5} max={480} value={form.dashboardIdleMinutes} onChange={num('dashboardIdleMinutes')} hint="Managers & HR are signed out after this much inactivity" />
            <Input label="Stay signed in on the app (days)" type="number" min={1} max={90} value={form.appSessionDays} onChange={num('appSessionDays')} hint="Employees stay signed in on their phone" />
          </div>
          <Input
            label="Max sessions per person"
            type="number"
            min={0}
            max={20}
            className="max-w-40"
            value={form.maxConcurrentSessions}
            onChange={num('maxConcurrentSessions')}
            hint="0 = unlimited. Older sessions are signed out when the limit is exceeded."
          />
        </Section>

        <Section icon={<Globe className="size-4" />} title="Dashboard IP allowlist" description="Only allow the HR/Manager dashboard from these networks. The employee app is not affected.">
          <Textarea label="Allowed IPs / ranges" value={ips} onChange={(e) => setIps(e.target.value)} placeholder={'203.0.113.10\n203.0.113.0/24'} hint="One per line. Leave empty to allow anywhere." />
          {myIp.data && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              Your current IP: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{myIp.data.ip}</code>
              {!splitList(ips).includes(myIp.data.ip) && (
                <Button size="sm" variant="ghost" onClick={() => setIps((v) => (v.trim() ? `${v.trim()}\n${myIp.data.ip}` : myIp.data.ip))}>
                  Add my IP
                </Button>
              )}
            </div>
          )}
          {splitList(ips).length > 0 && <Banner tone="warning">Make sure your own network is listed — otherwise you will be locked out of the dashboard.</Banner>}
        </Section>

        <Section icon={<Smartphone className="size-4" />} title="Two-factor authentication (HR & admins)">
          <Toggle label="Require authenticator app code" description="Extra security for accounts with dashboard access." checked={false} onChange={() => {}} disabled badge={<Badge tone="purple">Coming in Phase 2</Badge>} />
        </Section>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(next)} onReset={() => q.data && (setForm(q.data), setDomains(q.data.allowedEmailDomains.join('\n')), setIps(q.data.dashboardIpAllowlist.join('\n')))} />
    </div>
  );
}

// ---------------------------------------------------------------- Company default clock-in rules

function AttendanceDefaults() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'attendance-restrictions'], queryFn: () => api.get<AttendanceRestrictions>('/admin/settings/attendance-restrictions') });
  const [form, setForm] = useState<AttendanceRestrictions | null>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: AttendanceRestrictions) => api.put<AttendanceRestrictions>('/admin/settings/attendance-restrictions', body),
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'attendance-restrictions'], data);
      toast.success('Clock-in rules saved', 'They apply from the next clock-in.');
    },
    onError: (err) => toast.error('Could not save', errorMessage(err)),
  });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!form || !q.data) return <PageLoader />;
  const dirty = JSON.stringify(form) !== JSON.stringify(q.data);
  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand-600" /> Company default
            </span>
          }
          description="Applies to everyone unless a group rule or an individual override says otherwise. Default: simple clock-in with location, flag if outside the office."
        />
        <div className="px-4 sm:px-5">
          <AttendanceRestrictionFields value={form} onChange={(v) => setForm({ ...form, ...v } as AttendanceRestrictions)} />
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(form)} onReset={() => setForm(q.data)} />
    </>
  );
}

// ---------------------------------------------------------------- Group rules

function RestrictionPolicies() {
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['restriction-policies'], queryFn: () => api.get<RestrictionPolicy[]>('/admin/setup/restriction-policies') });
  const defaults = useQuery({ queryKey: ['settings', 'attendance-restrictions'], queryFn: () => api.get<AttendanceRestrictions>('/admin/settings/attendance-restrictions') });
  const [editing, setEditing] = useState<RestrictionPolicy | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RestrictionPolicy | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/setup/restriction-policies/${id}`),
    onSuccess: () => {
      toast.success('Rule deleted');
      qc.invalidateQueries({ queryKey: ['restriction-policies'] });
      setDeleting(null);
    },
    onError: (err) => toast.error('Could not delete', errorMessage(err)),
  });

  const summarize = (s: AttendanceRestrictionsPatch) => {
    const parts: string[] = [];
    if (s.geoCapture !== undefined) parts.push(`Location ${s.geoCapture ? 'on' : 'off'}`);
    if (s.geofenceMode) parts.push(`Geo-fence: ${s.geofenceMode.toLowerCase()}`);
    if (s.maxAccuracyMeters) parts.push(`Accuracy ≤ ${s.maxAccuracyMeters} m`);
    if (s.clockInWindow) parts.push(s.clockInWindow.enabled ? `Window ${s.clockInWindow.start}–${s.clockInWindow.end}` : 'No time window');
    if (s.deviceBinding) parts.push(s.deviceBinding.enabled ? `Device binding (${s.deviceBinding.maxDevices})` : 'No device binding');
    if (s.ipRestrictionMode) parts.push(`Network: ${s.ipRestrictionMode.toLowerCase()}`);
    if (s.remoteClockInOnApprovedRequests !== undefined) parts.push(`Remote on approved days ${s.remoteClockInOnApprovedRequests ? 'on' : 'off'}`);
    return parts;
  };

  return (
    <Card>
      <CardHeader
        title="Rules by group"
        description="Example: “Field sales — geo-fence off” for the Sales department, or “Factory — block outside geo-fence” for one location."
        action={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={!defaults.data}>
            Add rule
          </Button>
        }
      />
      {list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <PageLoader />
      ) : !list.data?.length ? (
        <EmptyState icon={<ShieldCheck className="size-6" />} title="No group rules yet" description="Everyone follows the company default. Add a rule to make a group stricter or more relaxed." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(p)}>
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {p.name}
                  {!p.isActive && <Badge>Inactive</Badge>}
                  {p.priority > 0 && <Badge tone="blue">Priority {p.priority}</Badge>}
                </p>
                <div className="mt-1">
                  <AppliesToSummary value={p.appliesTo} />
                </div>
                <p className="mt-1 text-sm text-slate-500">{summarize(p.settings).join(' · ') || 'No overrides'}</p>
              </button>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && defaults.data && <PolicyDialog policy={editing === 'new' ? null : editing} defaults={defaults.data} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        loading={del.isPending}
        title="Delete this rule?"
        message={`Employees covered by “${deleting?.name}” will fall back to the next matching rule or the company default.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </Card>
  );
}

function PolicyDialog({ policy, defaults, onClose }: { policy: RestrictionPolicy | null; defaults: AttendanceRestrictions; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: policy?.name ?? '',
    description: policy?.description ?? '',
    settings: policy?.settings ?? {},
    appliesTo: policy?.appliesTo ?? EMPTY_APPLIES_TO,
    priority: policy?.priority ?? 0,
    isActive: policy?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, description: form.description || null };
      return policy ? api.put(`/admin/setup/restriction-policies/${policy.id}`, body) : api.post('/admin/setup/restriction-policies', body);
    },
    onSuccess: () => {
      toast.success(policy ? 'Rule updated' : 'Rule created');
      qc.invalidateQueries({ queryKey: ['restriction-policies'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={policy ? `Edit “${policy.name}”` : 'New group rule'}
      description="Tick “Override” only for settings that should differ from the company default."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="restriction-policy" loading={save.isPending} disabled={!form.name.trim()}>
            Save rule
          </Button>
        </>
      }
    >
      <form id="restriction-policy" onSubmit={submit} className="space-y-5">
        {error && <Banner tone="error">{error}</Banner>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Rule name" required className="sm:col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Field sales" />
          <Input label="Priority" type="number" min={0} max={1000} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} hint="Breaks ties" />
        </div>
        <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <AppliesToEditor value={form.appliesTo} onChange={(appliesTo) => setForm({ ...form, appliesTo })} />
        <div className="rounded-xl border border-slate-200 px-4">
          <AttendanceRestrictionFields value={form.settings} onChange={(settings) => setForm({ ...form, settings })} inherited={defaults} />
        </div>
        <Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
      </form>
    </Dialog>
  );
}
