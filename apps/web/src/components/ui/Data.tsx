import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from './Display';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens (the mobile card shows `mobile` instead). */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Compact card layout used below the `md` breakpoint. */
  mobile?: (row: T) => ReactNode;
  selectable?: { selected: Set<string>; onChange: (s: Set<string>) => void };
}

/** Table on desktop, tappable cards on phones. */
export function DataTable<T>({ rows, columns, rowKey, loading, empty, onRowClick, mobile, selectable }: DataTableProps<T>) {
  if (loading && !rows) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (!rows?.length) return <>{empty}</>;
  const allSelected = !!selectable && rows.every((r) => selectable.selected.has(rowKey(r)));
  const toggle = (id: string) => {
    if (!selectable) return;
    const next = new Set(selectable.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectable.onChange(next);
  };

  return (
    <>
      {mobile && (
        <ul className="divide-y divide-slate-100 md:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className="flex items-start gap-3 px-4 py-3">
              {selectable && (
                <input type="checkbox" aria-label="Select" className="mt-1 size-4 accent-brand-600" checked={selectable.selected.has(rowKey(row))} onChange={() => toggle(rowKey(row))} />
              )}
              <div className={clsx('min-w-0 flex-1', onRowClick && 'cursor-pointer')} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {mobile(row)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={clsx('overflow-x-auto', mobile && 'hidden md:block')}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              {selectable && (
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-brand-600"
                    checked={allSelected}
                    onChange={() => selectable.onChange(allSelected ? new Set() : new Set(rows.map(rowKey)))}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx('px-4 py-2.5 whitespace-nowrap', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={clsx('hover:bg-slate-50/80', onRowClick && 'cursor-pointer')}>
                {selectable && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label="Select" className="size-4 accent-brand-600" checked={selectable.selected.has(rowKey(row))} onChange={() => toggle(rowKey(row))} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-4 py-3 text-slate-700', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 py-2 tabular-nums">
          {page} / {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={clsx('rounded-full px-1.5 py-0.5 text-xs tabular-nums', value === t.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
