import { STATUS_META, type AttendanceDay, type AttendanceStatus } from '@app/shared';
import { clsx } from 'clsx';
import { toneDot } from '../components/ui/Display';

const cellBg: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-900',
  orange: 'bg-orange-100 text-orange-800',
  yellow: 'bg-yellow-100 text-yellow-900',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  teal: 'bg-teal-100 text-teal-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  slate: 'bg-slate-100 text-slate-500',
  purple: 'bg-purple-100 text-purple-800',
  rose: 'bg-rose-100 text-rose-800',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-800',
};

export interface GridRow {
  id: string;
  name: string;
  sub?: string | null;
  cells: (AttendanceStatus | null)[];
}

/** Employees × days matrix of status codes (muster-roll style), horizontally scrollable on phones. */
export function MonthGrid({ days, rows, onCell }: { days: string[]; rows: GridRow[]; onCell?: (rowId: string, date: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-40 border-b border-slate-200 bg-white px-3 py-2 text-left font-medium text-slate-500">Employee</th>
            {days.map((d) => {
              const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
              return (
                <th key={d} className={clsx('border-b border-slate-200 px-0.5 py-2 text-center font-medium', wd === 0 || wd === 6 ? 'text-slate-400' : 'text-slate-600')}>
                  <div>{Number(d.slice(8))}</div>
                  <div className="text-[10px] font-normal">{'SMTWTFS'[wd]}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal">
                <p className="truncate font-medium text-slate-800">{r.name}</p>
                {r.sub && <p className="truncate text-[11px] text-slate-400">{r.sub}</p>}
              </th>
              {r.cells.map((s, i) => (
                <td key={days[i]} className="border-b border-slate-100 p-0.5 text-center">
                  <button
                    type="button"
                    disabled={!onCell}
                    onClick={() => onCell?.(r.id, days[i]!)}
                    title={s ? STATUS_META[s].label : 'No record'}
                    className={clsx('h-7 w-8 rounded text-[11px] font-semibold', s ? cellBg[STATUS_META[s].tone] : 'text-slate-300', onCell && 'hover:ring-2 hover:ring-brand-300')}
                  >
                    {s ?? '·'}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusLegend({ statuses }: { statuses: AttendanceStatus[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {statuses.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={clsx('size-2.5 rounded-full', toneDot[STATUS_META[s].tone])} />
          <strong>{s}</strong> {STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}

export const daysOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export const toCells = (days: string[], records: AttendanceDay[]) => {
  const map = new Map(records.map((r) => [r.date, r.status]));
  return days.map((d) => map.get(d) ?? null);
};
