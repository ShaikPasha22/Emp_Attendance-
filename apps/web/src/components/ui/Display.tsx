import { STATUS_META, type AttendanceStatus } from '@app/shared';
import { clsx } from 'clsx';
import { AlertTriangle, Inbox, Info, Loader2, XCircle, CheckCircle2 } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-2xl border border-slate-200 bg-white shadow-sm', className)} {...rest} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const tones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  yellow: 'bg-yellow-50 text-yellow-800 ring-yellow-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  teal: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
};

/** Solid dot colours for calendars/legends. */
export const toneDot: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  teal: 'bg-teal-500',
  indigo: 'bg-indigo-500',
  slate: 'bg-slate-300',
  purple: 'bg-purple-500',
  rose: 'bg-rose-500',
  fuchsia: 'bg-fuchsia-500',
};

export function Badge({ tone = 'slate', className, children }: { tone?: string; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone] ?? tones.slate, className)}>
      {children}
    </span>
  );
}

/** Attendance status with colour AND text (never colour alone). */
export function StatusBadge({ status, short }: { status: AttendanceStatus | null | undefined; short?: boolean }) {
  if (!status) return <Badge tone="slate">—</Badge>;
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={short ? 'px-1.5' : undefined}>
      {short ? status : meta.label}
    </Badge>
  );
}

const requestTones: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'slate' };
export function RequestStatusBadge({ status }: { status: string }) {
  return <Badge tone={requestTones[status] ?? 'slate'}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

const userTones: Record<string, string> = { ACTIVE: 'green', PENDING: 'amber', INVITED: 'blue', SUSPENDED: 'red', EXITED: 'slate' };
export function UserStatusBadge({ status }: { status: string }) {
  return <Badge tone={userTones[status] ?? 'slate'}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={clsx('inline-flex items-center gap-2 text-slate-500', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-200/70', className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-500">
        <XCircle className="size-6" />
      </div>
      <p className="font-medium text-slate-900">Couldn’t load this</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 text-sm font-medium text-brand-600 hover:text-brand-700">
          Try again
        </button>
      )}
    </div>
  );
}

type BannerTone = 'info' | 'warning' | 'error' | 'success';
const bannerStyles: Record<BannerTone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-blue-50 text-blue-800 border-blue-200', icon: <Info className="size-5 shrink-0" /> },
  warning: { box: 'bg-amber-50 text-amber-900 border-amber-200', icon: <AlertTriangle className="size-5 shrink-0" /> },
  error: { box: 'bg-red-50 text-red-800 border-red-200', icon: <XCircle className="size-5 shrink-0" /> },
  success: { box: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: <CheckCircle2 className="size-5 shrink-0" /> },
};

export function Banner({ tone = 'info', title, children, className }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const s = bannerStyles[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', s.box, className)}>
      {s.icon}
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, tone = 'slate', hint, icon }: { label: string; value: ReactNode; tone?: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <span className={clsx('rounded-lg p-1.5', tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span aria-hidden className={clsx('inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700', className)}>
      {initials || '?'}
    </span>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <dt className="text-slate-500">{i.label}</dt>
          <dd className="text-right font-medium text-slate-900">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
