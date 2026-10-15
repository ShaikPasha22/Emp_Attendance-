import { checkPassword } from '@app/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, ButtonLink } from '../components/ui/Button';
import { Banner } from '../components/ui/Display';
import { PasswordInput } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { AuthShell, PasswordChecklist, useAuthConfig } from './shared';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { data: config } = useAuthConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ok = config ? checkPassword(password, config.passwordRules).ok && password === confirm : false;

  if (!token) {
    return (
      <AuthShell title="Invalid link">
        <p className="text-sm text-slate-600">This reset link is incomplete. Please request a new one.</p>
        <ButtonLink to="/forgot-password" className="mt-4 w-full">
          Request new link
        </ButtonLink>
      </AuthShell>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Password updated', 'Please sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <PasswordInput label="New password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
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
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
