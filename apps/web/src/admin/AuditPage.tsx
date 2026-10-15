import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Card, DefinitionList, EmptyState, ErrorState, PageHeader } from '../components/ui/Display';
import { Dialog } from '../components/ui/Dialog';
import { Input, Select } from '../components/ui/Field';
import { DataTable, Pagination, type Column } from '../components/ui/Data';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface AuditItem {
  id: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

interface AuditResponse {
  items: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'User', label: 'Employee' },
  { value: 'Request', label: 'Request' },
  { value: 'AttendanceRecord', label: 'Attendance record' },
  { value: 'Company', label: 'Company settings' },
  { value: 'Shift', label: 'Shift' },
  { value: 'AttendancePolicy', label: 'Attendance policy' },
  { value: 'RestrictionPolicy', label: 'Restriction policy' },
  { value: 'Location', label: 'Location' },
  { value: 'WorkflowDefinition', label: 'Workflow' },
  { value: 'Department', label: 'Department' },
  { value: 'PermissionProfile', label: 'Permission profile' },
  { value: 'Report', label: 'Report' },
];

const entityLabel = (t: string) => ENTITY_TYPES.find((e) => e.value === t)?.label ?? t.replace(/([a-z])([A-Z])/g, '$1 $2');

/** "user.invited" → tone by verb; colour always paired with the action text. */
function actionTone(action: string) {
  const verb = action.split('.').pop() ?? '';
  if (/(created|invited|approved|activated|restored)/.test(verb)) return 'green';
  if (/(deleted|rejected|suspended|exited|revoked|failed|blocked)/.test(verb)) return 'red';
  if (/(updated|changed|edited|reset|assigned)/.test(verb)) return 'blue';
  return 'slate';
}

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge tone={actionTone(action)} className="font-mono">
      {action}
    </Badge>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const q = useDebounced(search.trim(), 300);

  // Back to the first page whenever the filters change.
  const filterKey = `${q}|${entityType}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) params.set('q', q);
  if (entityType) params.set('entityType', entityType);

  const query = useQuery({
    queryKey: ['audit', page, q, entityType],
    queryFn: ({ signal }) => api.get<AuditResponse>(`/admin/audit?${params.toString()}`, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AuditItem>[] = [
    { key: 'time', header: 'Time', cell: (r) => <span className="whitespace-nowrap text-slate-500">{formatDateTime(r.createdAt)}</span> },
    { key: 'actor', header: 'Actor', cell: (r) => <span className="font-medium whitespace-nowrap text-slate-900">{r.actorName ?? 'System'}</span> },
    { key: 'summary', header: 'Summary', cell: (r) => <span className="line-clamp-2">{r.summary ?? '—'}</span> },
    { key: 'action', header: 'Action', cell: (r) => <ActionBadge action={r.action} /> },
    { key: 'entity', header: 'Entity', cell: (r) => <span className="whitespace-nowrap">{entityLabel(r.entityType)}</span> },
  ];

  const filtered = !!q || !!entityType;

  return (
    <div>
      <PageHeader title="Audit log" description="Every change made by admins, HR and the system. Click an entry to see exactly what changed." />
      <Card>
        <div className="grid gap-3 border-b border-slate-100 px-4 py-3 sm:grid-cols-[1fr_14rem] sm:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              aria-label="Search audit log"
              placeholder="Search by person, action or summary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="[&_input]:pl-9"
            />
          </div>
          <Select aria-label="Filter by entity type" placeholder="All entities" options={ENTITY_TYPES} value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        </div>

        {query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (
          <div className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={query.isFetching || undefined}>
            <DataTable
              rows={query.data?.items}
              loading={query.isLoading}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={setSelected}
              empty={
                <EmptyState
                  icon={<History className="size-6" />}
                  title={filtered ? 'No matching entries' : 'No activity yet'}
                  description={filtered ? 'Try a different search or entity filter.' : 'Changes to settings, employees and attendance will appear here.'}
                />
              }
              mobile={(r) => (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{r.summary ?? r.action}</p>
                    <span className="shrink-0 text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {r.actorName ?? 'System'} · {entityLabel(r.entityType)}
                  </p>
                  <ActionBadge action={r.action} />
                </div>
              )}
            />
          </div>
        )}
        {query.data && <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onChange={setPage} />}
      </Card>

      <AuditDetailDialog item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</h3>
      {value === null || value === undefined ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">Nothing recorded</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(value, null, 2)}</pre>
      )}
    </section>
  );
}

function AuditDetailDialog({ item, onClose }: { item: AuditItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onClose={onClose} size="lg" title={item?.summary ?? item?.action ?? 'Audit entry'} description={item ? formatDateTime(item.createdAt) : undefined}>
      {item && (
        <div className="space-y-4">
          <DefinitionList
            items={[
              { label: 'Actor', value: item.actorName ?? 'System' },
              { label: 'Action', value: <ActionBadge action={item.action} /> },
              { label: 'Entity', value: entityLabel(item.entityType) },
              { label: 'Entity ID', value: item.entityId ? <span className="font-mono text-xs break-all">{item.entityId}</span> : null },
              { label: 'IP address', value: item.ip ? <span className="font-mono text-xs">{item.ip}</span> : null },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <JsonBlock title="Before" value={item.before} />
            <JsonBlock title="After" value={item.after} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
