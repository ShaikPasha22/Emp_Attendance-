import { checkPassword, EMPLOYEE_TYPE_LABELS, WEEKDAYS, type EmployeeType, type ShiftInfo } from '@app/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PasswordChecklist, useAuthConfig } from '../auth/shared';
import { Button } from '../components/ui/Button';
import { Avatar, Banner, Card, CardHeader, DefinitionList, ErrorState, PageLoader } from '../components/ui/Display';
import { Dialog } from '../components/ui/Dialog';
import { PasswordInput } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

interface Profile {
  employeeCode: string;
  name: string;
  email: string;
  phone: string | null;
  employeeType: EmployeeType;
  joiningDate: string | null;
  department: string | null;
  designation: string | null;
  businessUnit: string | null;
  grade: string | null;
  location: string | null;
  manager: { name: string; email: string } | null;
  shift: ShiftInfo | null;
  weeklyOffs: number[];
  timezone: string;
}

export default function ProfilePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get<Profile>('/me/profile') });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card className="flex items-center gap-4 p-5">
        <Avatar name={p.name} className="size-14 text-lg" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900">{p.name}</h1>
          <p className="truncate text-sm text-slate-500">
            {p.designation ?? 'Employee'} · {p.employeeCode}
          </p>
          <p className="truncate text-sm text-slate-500">{p.email}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Work details" />
        <div className="px-5 pb-2">
          <DefinitionList
            items={[
              { label: 'Department', value: p.department },
              { label: 'Business unit', value: p.businessUnit },
              { label: 'Location', value: p.location },
              { label: 'Reporting manager', value: p.manager?.name },
              { label: 'Employee type', value: EMPLOYEE_TYPE_LABELS[p.employeeType] },
              { label: 'Grade', value: p.grade },
              { label: 'Joined', value: p.joiningDate ? formatDate(p.joiningDate, { day: 'numeric', month: 'short', year: 'numeric' }) : null },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Shift & schedule" />
        <div className="px-5 pb-2">
          <DefinitionList
            items={[
              { label: 'Shift', value: p.shift ? `${p.shift.name} (${p.shift.startTime} – ${p.shift.endTime})` : 'Not assigned' },
              { label: 'Grace period', value: p.shift ? `${p.shift.graceMinutes} minutes` : null },
              { label: 'Weekly offs', value: WEEKDAYS.filter((d) => p.weeklyOffs.includes(d.value)).map((d) => d.short).join(', ') || 'None' },
              { label: 'Timezone', value: p.timezone },
            ]}
          />
        </div>
      </Card>

      <Card className="divide-y divide-slate-100">
        <button type="button" onClick={() => setPwOpen(true)} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">
          <KeyRound className="size-5 text-slate-400" /> Change password
        </button>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <LogOut className="size-5" /> Sign out
        </button>
      </Card>
      <p className="text-center text-xs text-slate-400">Your location is captured only when you clock in or out — never in the background.</p>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data: config } = useAuthConfig();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: (res) => {
      toast.success('Password changed', res.message);
      setCurrent('');
      setNext('');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const ok = !!current && (config ? checkPassword(next, config.passwordRules).ok : false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="change-pw" loading={m.isPending} disabled={!ok}>
            Update password
          </Button>
        </>
      }
    >
      <form id="change-pw" onSubmit={submit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <PasswordInput label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <div>
          <PasswordInput label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <PasswordChecklist password={next} rules={config?.passwordRules} />
        </div>
      </form>
    </Dialog>
  );
}
