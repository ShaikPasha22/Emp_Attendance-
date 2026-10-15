import { checkPassword } from '@app/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, ButtonLink } from '../components/ui/Button';
import { Banner } from '../components/ui/Display';
import { Input, PasswordInput } from '../components/ui/Field';
import { api, errorMessage } from '../lib/api';
import { AuthShell, PasswordChecklist, useAuthConfig } from './shared';

export default function SignupPage() {
  const { data: config } = useAuthConfig();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const passwordOk = config ? checkPassword(form.password, config.passwordRules).ok : false;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/signup', { ...form, phone: form.phone || undefined });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Request sent">
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" />
          <p className="text-sm text-slate-600">HR has been notified. You’ll be able to sign in as soon as your access is approved — we’ll email you.</p>
          <ButtonLink to="/login" variant="secondary" className="mt-2 w-full">
            Back to sign in
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  if (config && !config.signupEnabled) {
    return (
      <AuthShell title="Sign-up is closed">
        <p className="text-sm text-slate-600">Accounts are created by HR. Please ask HR to send you an invitation.</p>
        <ButtonLink to="/login" variant="secondary" className="mt-4 w-full">
          Back to sign in
        </ButtonLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Request access"
      subtitle="HR will review and approve your account."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" required autoComplete="given-name" value={form.firstName} onChange={set('firstName')} />
          <Input label="Last name" required autoComplete="family-name" value={form.lastName} onChange={set('lastName')} />
        </div>
        <Input
          label="Work email"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          hint={config?.allowedEmailDomains.length ? `Use your ${config.allowedEmailDomains.map((d) => '@' + d).join(' or ')} email` : undefined}
        />
        <Input label="Phone (optional)" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        <div>
          <PasswordInput label="Create password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
          <PasswordChecklist password={form.password} rules={config?.passwordRules} />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!passwordOk || !form.email || !form.firstName || !form.lastName}>
          Send request
        </Button>
      </form>
    </AuthShell>
  );
}
