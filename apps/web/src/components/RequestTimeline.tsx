import { APPROVER_TYPE_LABELS, type RequestDto } from '@app/shared';
import { clsx } from 'clsx';
import { Check, Clock, X } from 'lucide-react';
import { formatDate, formatDateTime } from '../lib/format';
import { DefinitionList, RequestStatusBadge } from './ui/Display';

/** Request summary plus a step-by-step approval trail. */
export function RequestTimeline({ request: r }: { request: RequestDto }) {
  const steps = r.levels.map((lvl, i) => {
    const decision = r.approvals.filter((a) => a.level === i).at(-1);
    const state = decision ? decision.decision : r.status === 'PENDING' && i === r.currentLevel ? 'WAITING' : r.status === 'PENDING' ? 'UPCOMING' : 'SKIPPED';
    return { label: APPROVER_TYPE_LABELS[lvl.approverType], decision, state };
  });
  return (
    <div className="space-y-5">
      <DefinitionList
        items={[
          { label: 'Employee', value: `${r.user.name} (${r.user.employeeCode})` },
          { label: r.startDate === r.endDate ? 'Date' : 'Dates', value: r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` },
          ...(r.type === 'REGULARIZATION' ? [{ label: 'Requested times', value: `${String(r.payload.clockIn)} – ${String(r.payload.clockOut)}` }] : []),
          { label: 'Status', value: <RequestStatusBadge status={r.status} /> },
        ]}
      />
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">Reason</p>
        <p className="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">{r.reason}</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Approvals</p>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={clsx(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                  s.state === 'APPROVED' && 'bg-emerald-100 text-emerald-700',
                  s.state === 'REJECTED' && 'bg-red-100 text-red-700',
                  s.state === 'WAITING' && 'bg-amber-100 text-amber-700',
                  (s.state === 'UPCOMING' || s.state === 'SKIPPED') && 'bg-slate-100 text-slate-400',
                )}
              >
                {s.state === 'APPROVED' ? <Check className="size-3.5" /> : s.state === 'REJECTED' ? <X className="size-3.5" /> : <Clock className="size-3.5" />}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-slate-900">
                  {s.label}
                  <span className="ml-2 font-normal text-slate-500">
                    {s.state === 'WAITING' ? 'Waiting for approval' : s.state === 'UPCOMING' ? 'Next' : s.state === 'SKIPPED' ? 'Not needed' : ''}
                  </span>
                </p>
                {s.decision && (
                  <p className="text-slate-500">
                    {s.decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by {s.decision.approver} · {formatDateTime(s.decision.createdAt)}
                  </p>
                )}
                {s.decision?.comment && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-slate-700">“{s.decision.comment}”</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
