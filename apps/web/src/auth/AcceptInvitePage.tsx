import { checkPassword, type LoginResponse } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, ButtonLink } from '../components/ui/Button';
import { Banner, PageLoader } from '../components/ui/Display';
import { PasswordInput } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthShell, PasswordChecklist, useAuthConfig } from './shared';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { data: config } = useAuthConfig();
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ firstName: string; email: string }>(`/auth/invite/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ok = config ? checkPassword(password, config.passwordRules).ok && password === confirm : false;

  if (!token || invite.isError) {
    return (
      <AuthShell title="Invitation not valid">
        <p className="text-sm text-slate-600">{invite.error ? errorMessage(invite.error) : 'This invitation link is incomplete.'}</p>
        <ButtonLink to="/login" variant="secondary" className="mt-4 w-full">
          Go to sign in
        </ButtonLink>
      </AuthShell>
    );
  }
  if (invite.isLoading) return <PageLoader />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/accept-invite', { token, password });
      completeLogin(res);
      toast.success('Welcome aboard!', 'Your account is ready.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={`Welcome, ${invite.data?.firstName ?? ''}!`} subtitle={`Set a password for ${invite.data?.email ?? 'your account'} to get started.`}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <PasswordInput label="Password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <PasswordChecklist password={password} rules={config?.passwordRules} />
        </div>
        <PasswordInput
          label="Confirm password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== password ? 'Passwords do not match' : undefined}
        />
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!ok}>
          Activate my account
        </Button>
      </form>
    </AuthShell>
  );
}
