import { clsx } from 'clsx';
import { LogIn, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ClockCard, useToday } from '../components/ClockCard';
import { Dialog } from '../components/ui/Dialog';
import { elapsed } from '../lib/format';

/** Header button so managers and HR can clock in/out without leaving the dashboard. */
export function QuickClock() {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { data } = useToday();
  const record = data?.record;
  const working = !!record?.clockIn && !record.clockOut;
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [working]);

  const label = !data ? 'Attendance' : working ? elapsed(record!.clockIn!, now).slice(0, 5) : record?.clockOut ? 'Clocked out' : 'Clock in';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
          working ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : record?.clockOut ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
        )}
        aria-label={working ? `Working for ${label}. Open clock` : label}
      >
        {working ? (
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        ) : record?.clockOut ? (
          <Timer className="size-4" />
        ) : (
          <LogIn className="size-4" />
        )}
        <span className="tabular-nums">{label}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="My attendance" size="md">
        <ClockCard onPunched={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
