import { checkPassword, type PasswordRules } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../components/ui/Display';
import { ConnectionBanner, Logo } from '../layouts/common';
import { api } from '../lib/api';

export interface AuthConfig {
  companyName: string;
  signupEnabled: boolean;
  allowedEmailDomains: string[];
  passwordRules: PasswordRules;
}

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<AuthConfig>('/auth/config'), staleTime: 5 * 60_000 });

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { data } = useAuthConfig();
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <ConnectionBanner />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo />
          {data?.companyName && <p className="text-sm text-slate-500">{data.companyName}</p>}
        </div>
        <Card className="w-full max-w-sm p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
        {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
      </div>
    </div>
  );
}

export function PasswordChecklist({ password, rules }: { password: string; rules?: PasswordRules }) {
  if (!rules) return null;
  const { checks } = checkPassword(password, rules);
  return (
    <ul className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
      {checks.map((c) => (
        <li key={c.label} className={clsx('flex items-center gap-1.5', c.ok ? 'text-emerald-600' : 'text-slate-500')}>
          {c.ok ? <Check className="size-3.5" /> : <Circle className="size-3" />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}
