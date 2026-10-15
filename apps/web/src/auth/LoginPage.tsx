import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/ui/Button';
import { Banner } from '../components/ui/Display';
import { Input, PasswordInput } from '../components/ui/Field';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthShell, useAuthConfig } from './shared';

export default function LoginPage() {
  const { login } = useAuth();
  const { data: config } = useAuthConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back! Sign in to mark your attendance."
      footer={
        config?.signupEnabled ? (
          <>
            New here?{' '}
            <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">
              Request access
            </Link>
          </>
        ) : (
          'Need an account? Ask HR to invite you.'
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Banner tone="error">{error}</Banner>}
        <Input label="Work email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
