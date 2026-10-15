import { APPROVER_TYPE_LABELS, APPROVER_TYPES, PERMISSIONS, REQUEST_TYPE_LABELS, type ApproverType, type RequestType } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronRight, Plus, Timer, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Banner, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui/Display';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Level {
  approverType: ApproverType;
}

interface Workflow {
  requestType: RequestType;
  levels: Level[];
  escalationDays: number | null;
}

const MAX_LEVELS = 3;

const REQUEST_HINTS: Record<RequestType, string> = {
  REGULARIZATION: 'Fixing a missed or wrong clock-in / clock-out.',
  WFH: 'Working remotely for one or more days.',
  ON_DUTY: 'Working away from the office, e.g. a client visit.',
};

export default function WorkflowsPage() {
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['workflows'], queryFn: () => api.get<Workflow[]>('/admin/settings/workflows') });

  return (
    <div>
      <PageHeader title="Approval workflows" description="Who approves each type of employee request, and in what order. Every level must approve before a request is accepted." />
      <Banner tone="info" className="mb-4">
        If an employee has no active reporting manager, the manager step is skipped automatically.
      </Banner>
      {q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : q.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {(q.data ?? []).map((wf) => (
            // Re-mount when the server copy changes so local edits reset after saving.
            <WorkflowCard key={`${wf.requestType}-${JSON.stringify(wf.levels)}`} workflow={wf} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ workflow, canEdit }: { workflow: Workflow; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [levels, setLevels] = useState<Level[]>(workflow.levels);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(levels) !== JSON.stringify(workflow.levels);
  const unused = APPROVER_TYPES.filter((t) => !levels.some((l) => l.approverType === t));

  const save = useMutation({
    mutationFn: () => api.put<Workflow>(`/admin/settings/workflows/${workflow.requestType}`, { levels, escalationDays: workflow.escalationDays }),
    onSuccess: () => {
      toast.success(`${REQUEST_TYPE_LABELS[workflow.requestType]} workflow saved`);
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const move = (i: number, delta: number) =>
    setLevels((ls) => {
      const next = [...ls];
      const j = i + delta;
      const a = next[i];
      const b = next[j];
      if (!a || !b) return ls;
      next[i] = b;
      next[j] = a;
      return next;
    });
  const removeAt = (i: number) => setLevels((ls) => ls.filter((_, idx) => idx !== i));
  const add = (t: ApproverType) => setLevels((ls) => [...ls, { approverType: t }]);

  return (
    <Card className="flex flex-col">
      <CardHeader title={REQUEST_TYPE_LABELS[workflow.requestType]} description={REQUEST_HINTS[workflow.requestType]} />
      <div className="flex-1 space-y-4 px-4 py-4 sm:px-5">
        <ChainPreview levels={levels} />

        {error && <Banner tone="error">{error}</Banner>}

        <ol className="space-y-2" aria-label="Approval levels">
          {levels.map((l, i) => (
            <li key={l.approverType} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700" aria-hidden>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{APPROVER_TYPE_LABELS[l.approverType]}</p>
                <p className="text-xs text-slate-500">Level {i + 1}</p>
              </div>
              {canEdit && (
                <div className="-mr-1 flex">
                  <IconButton label={`Move ${APPROVER_TYPE_LABELS[l.approverType]} up`} disabled={i === 0} onClick={() => move(i, -1)} className="size-9 disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Move ${APPROVER_TYPE_LABELS[l.approverType]} down`}
                    disabled={i === levels.length - 1}
                    onClick={() => move(i, 1)}
                    className="size-9 disabled:opacity-30"
                  >
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Remove ${APPROVER_TYPE_LABELS[l.approverType]}`}
                    disabled={levels.length <= 1}
                    onClick={() => removeAt(i)}
                    className="size-9 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>

        {canEdit && levels.length < MAX_LEVELS && unused.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unused.map((t) => (
              <Button key={t} size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => add(t)}>
                Add {APPROVER_TYPE_LABELS[t]}
              </Button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-slate-500">
            <Timer className="size-4" aria-hidden />
            Auto-escalation
          </span>
          <Badge tone="slate">Coming in Phase 2</Badge>
        </div>
      </div>
      {canEdit && (
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setLevels(workflow.levels);
                setError(null);
              }}
            >
              Reset
            </Button>
          )}
          <Button
            loading={save.isPending}
            disabled={!dirty || levels.length === 0}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

function ChainPreview({ levels }: { levels: Level[] }) {
  const steps = ['Employee', ...levels.map((l) => APPROVER_TYPE_LABELS[l.approverType])];
  return (
    <div role="group" className="flex flex-wrap items-center gap-1.5 text-sm" aria-label={`Approval chain: ${steps.join(', then ')}`}>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <ChevronRight className="size-4 text-slate-400" aria-hidden />}
          <Badge tone={i === 0 ? 'slate' : 'brand'} className="py-1">
            {s}
          </Badge>
        </Fragment>
      ))}
      <ChevronRight className="size-4 text-slate-400" aria-hidden />
      <Badge tone="green" className="py-1">
        Approved
      </Badge>
    </div>
  );
}
