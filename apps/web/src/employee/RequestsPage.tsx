import { REQUEST_TYPE_LABELS, type RequestDto, type RequestType } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { Banner, Card, EmptyState, ErrorState, PageHeader, RequestStatusBadge, Skeleton } from '../components/ui/Display';
import { Dialog, ConfirmDialog } from '../components/ui/Dialog';
import { Input, Segmented, Textarea } from '../components/ui/Field';
import { Tabs } from '../components/ui/Data';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatDateTime, todayKey } from '../lib/format';
import { RequestTimeline } from '../components/RequestTimeline';

type Filter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';

export default function RequestsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = location.pathname.endsWith('/new');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<RequestDto | null>(null);
  const q = useQuery({ queryKey: ['requests', 'mine'], queryFn: () => api.get<RequestDto[]>('/requests/me') });
  const rows = (q.data ?? []).filter((r) => filter === 'ALL' || r.status === filter);
  const count = (s: Filter) => (q.data ?? []).filter((r) => r.status === s).length;

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Attendance corrections, work from home and on-duty requests."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => navigate('/requests/new')}>
            New request
          </Button>
        }
      />
      <Card>
        <div className="px-4 pt-1 sm:px-5">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'ALL', label: 'All' },
              { value: 'PENDING', label: 'Pending', count: count('PENDING') },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
            ]}
          />
        </div>
        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={filter === 'ALL' ? 'No requests yet' : `No ${filter.toLowerCase()} requests`}
            description="Missed a clock-in or working remotely? Raise a request and your manager will be notified."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSelected(r)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{REQUEST_TYPE_LABELS[r.type]}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`}
                      {r.type === 'REGULARIZATION' && ` · ${String(r.payload.clockIn)}–${String(r.payload.clockOut)}`}
                    </p>
                  </div>
                  <RequestStatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NewRequestDialog
        open={isNew}
        initialType={(params.get('type') as RequestType | null) ?? 'REGULARIZATION'}
        initialDate={params.get('date') ?? undefined}
        onClose={() => navigate('/requests', { replace: true })}
      />
      <RequestDetailDialog request={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function NewRequestDialog({ open, initialType, initialDate, onClose }: { open: boolean; initialType: RequestType; initialDate?: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = todayKey();
  const [type, setType] = useState<RequestType>(initialType);
  const [form, setForm] = useState({ date: initialDate ?? today, startDate: initialDate ?? today, endDate: initialDate ?? today, clockIn: '09:30', clockOut: '18:30', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [lastOpenKey, setLastOpenKey] = useState('');

  // Reset the form each time the dialog opens with new prefill values.
  const openKey = `${open}-${initialType}-${initialDate}`;
  if (open && openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    setType(initialType);
    setForm((f) => ({ ...f, date: initialDate ?? today, startDate: initialDate ?? today, endDate: initialDate ?? today, reason: '' }));
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<RequestDto>(
        '/requests',
        type === 'REGULARIZATION'
          ? { type, date: form.date, clockIn: form.clockIn, clockOut: form.clockOut, reason: form.reason }
          : { type, startDate: form.startDate, endDate: form.endDate, reason: form.reason },
      ),
    onSuccess: () => {
      toast.success('Request submitted', 'Your approver has been notified.');
      qc.invalidateQueries({ queryKey: ['requests'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New request"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-request" loading={create.isPending} disabled={form.reason.trim().length < 5}>
            Submit request
          </Button>
        </>
      }
    >
      <form id="new-request" onSubmit={submit} className="space-y-4">
        <Segmented<RequestType>
          label="Request type"
          value={type}
          onChange={setType}
          options={[
            { value: 'REGULARIZATION', label: 'Correction' },
            { value: 'WFH', label: 'Work from home' },
            { value: 'ON_DUTY', label: 'On duty' },
          ]}
        />
        {error && <Banner tone="error">{error}</Banner>}
        {type === 'REGULARIZATION' ? (
          <>
            <Input label="Date" type="date" required max={today} value={form.date} onChange={set('date')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Clock in" type="time" required value={form.clockIn} onChange={set('clockIn')} />
              <Input label="Clock out" type="time" required value={form.clockOut} onChange={set('clockOut')} />
            </div>
            <p className="text-xs text-slate-500">Enter the actual times you started and finished work that day.</p>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Input label="From" type="date" required value={form.startDate} onChange={set('startDate')} />
            <Input label="To" type="date" required min={form.startDate} value={form.endDate} onChange={set('endDate')} />
          </div>
        )}
        <Textarea
          label="Reason"
          required
          value={form.reason}
          onChange={set('reason')}
          placeholder={type === 'REGULARIZATION' ? 'e.g. Forgot to clock out after the client call' : type === 'WFH' ? 'e.g. Waiting for a home appliance repair' : 'e.g. Client visit at Whitefield'}
          hint="Your manager will see this."
        />
      </form>
    </Dialog>
  );
}

function RequestDetailDialog({ request, onClose }: { request: RequestDto | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api.post(`/requests/${request!.id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      qc.invalidateQueries({ queryKey: ['requests'] });
      setConfirm(false);
      onClose();
    },
    onError: (err) => toast.error('Could not cancel', errorMessage(err)),
  });
  return (
    <>
      <Dialog
        open={!!request && !confirm}
        onClose={onClose}
        title={request ? REQUEST_TYPE_LABELS[request.type] : ''}
        description={request ? `Submitted ${formatDateTime(request.createdAt)}` : undefined}
        footer={
          request?.status === 'PENDING' && (
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Cancel request
            </Button>
          )
        }
      >
        {request && <RequestTimeline request={request} />}
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => cancel.mutate()}
        loading={cancel.isPending}
        title="Cancel this request?"
        message="Your approvers will no longer see it. You can raise a new one later."
        confirmLabel="Yes, cancel"
        tone="danger"
      />
    </>
  );
}
