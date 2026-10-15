import { APPROVER_TYPE_LABELS, REQUEST_TYPE_LABELS, type RequestDto } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckSquare, X } from 'lucide-react';
import { useState } from 'react';
import { RequestTimeline } from '../components/RequestTimeline';
import { Button } from '../components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, PageHeader, RequestStatusBadge } from '../components/ui/Display';
import { DataTable, Tabs, type Column } from '../components/ui/Data';
import { Dialog } from '../components/ui/Dialog';
import { Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { api, errorMessage } from '../lib/api';
import { formatDate, relativeTime } from '../lib/format';

type View = 'inbox' | 'history';

const dates = (r: RequestDto) => (r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`);
const detail = (r: RequestDto) => (r.type === 'REGULARIZATION' ? `${String(r.payload.clockIn)} – ${String(r.payload.clockOut)}` : null);

export default function ApprovalsPage() {
  const [view, setView] = useState<View>('inbox');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<RequestDto | null>(null);
  const [bulk, setBulk] = useState<'APPROVE' | 'REJECT' | null>(null);
  const inbox = useQuery({ queryKey: ['requests', 'inbox'], queryFn: () => api.get<RequestDto[]>('/requests/inbox') });
  const history = useQuery({ queryKey: ['requests', 'history'], queryFn: () => api.get<RequestDto[]>('/requests/history'), enabled: view === 'history' });
  const q = view === 'inbox' ? inbox : history;

  const columns: Column<RequestDto>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.user.name}</p>
          <p className="text-xs text-slate-500">
            {r.user.employeeCode}
            {r.user.department ? ` · ${r.user.department}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'type', header: 'Request', cell: (r) => <Badge tone="brand">{REQUEST_TYPE_LABELS[r.type]}</Badge> },
    {
      key: 'dates',
      header: 'Dates',
      cell: (r) => (
        <div>
          <p>{dates(r)}</p>
          {detail(r) && <p className="text-xs text-slate-500">{detail(r)}</p>}
        </div>
      ),
    },
    { key: 'reason', header: 'Reason', cell: (r) => <p className="max-w-xs truncate text-slate-600">{r.reason}</p> },
    {
      key: 'stage',
      header: view === 'inbox' ? 'Your step' : 'Status',
      cell: (r) =>
        view === 'inbox' ? (
          <span className="text-xs text-slate-500">
            {APPROVER_TYPE_LABELS[r.levels[r.currentLevel]!.approverType]} · step {r.currentLevel + 1}/{r.levels.length}
          </span>
        ) : (
          <RequestStatusBadge status={r.status} />
        ),
    },
    { key: 'age', header: 'Submitted', cell: (r) => <span className="text-xs text-slate-500">{relativeTime(r.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Approvals" description="Review attendance corrections, work-from-home and on-duty requests." />
      <Card>
        <div className="flex flex-col gap-3 px-4 pt-1 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <Tabs<View>
            value={view}
            onChange={(v) => {
              setView(v);
              setSelected(new Set());
            }}
            tabs={[
              { value: 'inbox', label: 'Waiting for me', count: inbox.data?.length },
              { value: 'history', label: 'My decisions' },
            ]}
          />
          {view === 'inbox' && selected.size > 0 && (
            <div className="flex gap-2 pb-2 sm:pb-0">
              <Button size="sm" variant="success" icon={<Check className="size-4" />} onClick={() => setBulk('APPROVE')}>
                Approve {selected.size}
              </Button>
              <Button size="sm" variant="secondary" icon={<X className="size-4" />} onClick={() => setBulk('REJECT')}>
                Reject
              </Button>
            </div>
          )}
        </div>
        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={setOpen}
            selectable={view === 'inbox' ? { selected, onChange: setSelected } : undefined}
            empty={
              <EmptyState
                icon={<CheckSquare className="size-6" />}
                title={view === 'inbox' ? 'Nothing waiting for you' : 'No decisions yet'}
                description={view === 'inbox' ? 'New requests from your team will show up here.' : undefined}
              />
            }
            mobile={(r) => (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{r.user.name}</p>
                  {view === 'history' ? <RequestStatusBadge status={r.status} /> : <span className="text-xs text-slate-400">{relativeTime(r.createdAt)}</span>}
                </div>
                <p className="text-sm text-slate-600">
                  {REQUEST_TYPE_LABELS[r.type]} · {dates(r)}
                  {detail(r) ? ` · ${detail(r)}` : ''}
                </p>
                <p className="mt-0.5 truncate text-sm text-slate-500">{r.reason}</p>
              </div>
            )}
          />
        )}
      </Card>

      <DecisionDialog request={open} canDecide={view === 'inbox'} onClose={() => setOpen(null)} />
      <BulkDialog
        decision={bulk}
        ids={[...selected]}
        onClose={() => setBulk(null)}
        onDone={() => {
          setBulk(null);
          setSelected(new Set());
        }}
      />
    </div>
  );
}

function useInvalidateRequests() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

function DecisionDialog({ request, canDecide, onClose }: { request: RequestDto | null; canDecide: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateRequests();
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const close = () => {
    setComment('');
    setRejecting(false);
    onClose();
  };
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'reject') => api.post<RequestDto>(`/requests/${request!.id}/${d}`, { comment: comment || undefined }),
    onSuccess: (res, d) => {
      toast.success(d === 'approve' ? (res.status === 'APPROVED' ? 'Request approved' : 'Approved — sent to next approver') : 'Request rejected');
      invalidate();
      close();
    },
    onError: (err) => toast.error('Could not save decision', errorMessage(err)),
  });

  return (
    <Dialog
      open={!!request}
      onClose={close}
      title={request ? `${REQUEST_TYPE_LABELS[request.type]} — ${request.user.name}` : ''}
      size="md"
      footer={
        canDecide &&
        request?.status === 'PENDING' &&
        (rejecting ? (
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              Back
            </Button>
            <Button variant="danger" loading={decide.isPending} disabled={comment.trim().length < 3} onClick={() => decide.mutate('reject')}>
              Confirm rejection
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" icon={<X className="size-4" />} onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <Button variant="success" icon={<Check className="size-4" />} loading={decide.isPending} onClick={() => decide.mutate('approve')}>
              Approve
            </Button>
          </>
        ))
      }
    >
      {request && (
        <div className="space-y-4">
          <RequestTimeline request={request} />
          {canDecide && request.status === 'PENDING' && (
            <Textarea
              label={rejecting ? 'Reason for rejection' : 'Comment (optional)'}
              required={rejecting}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={rejecting ? 'Let the employee know why' : 'Visible to the employee'}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}

function BulkDialog({ decision, ids, onClose, onDone }: { decision: 'APPROVE' | 'REJECT' | null; ids: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateRequests();
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ results: { id: string; ok: boolean; error?: string }[] }>('/requests/bulk', { ids, decision, comment: comment || undefined }),
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      if (failed) toast.warning(`${ok} done, ${failed} failed`, res.results.find((r) => !r.ok)?.error);
      else toast.success(`${ok} request${ok > 1 ? 's' : ''} ${decision === 'APPROVE' ? 'approved' : 'rejected'}`);
      invalidate();
      setComment('');
      onDone();
    },
    onError: (err) => toast.error('Bulk action failed', errorMessage(err)),
  });
  return (
    <Dialog
      open={!!decision}
      onClose={onClose}
      title={`${decision === 'APPROVE' ? 'Approve' : 'Reject'} ${ids.length} request${ids.length > 1 ? 's' : ''}?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision === 'APPROVE' ? 'success' : 'danger'} loading={m.isPending} disabled={decision === 'REJECT' && comment.trim().length < 3} onClick={() => m.mutate()}>
            {decision === 'APPROVE' ? 'Approve all' : 'Reject all'}
          </Button>
        </>
      }
    >
      <Textarea
        label={decision === 'REJECT' ? 'Reason for rejection' : 'Comment (optional)'}
        required={decision === 'REJECT'}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </Dialog>
  );
}
