import { EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPES, EMPTY_APPLIES_TO, type AppliesTo, type EmployeeType } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '../components/ui/Display';
import { api } from '../lib/api';

export interface Option {
  id: string;
  name: string;
  isActive?: boolean;
}

export interface Lookups {
  businessUnits: Option[];
  departments: Option[];
  designations: Option[];
  grades: Option[];
  locations: Option[];
  shifts: Option[];
  profiles: { id: string; name: string; scope: string }[];
  employees: Option[];
}

/** Every dropdown option for the dashboard, loaded once and cached. */
export const useLookups = () =>
  useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/admin/settings/lookups'), staleTime: 60_000 });

export const toOptions = (list: Option[] | undefined, includeInactive = false) =>
  (list ?? []).filter((o) => includeInactive || o.isActive !== false).map((o) => ({ value: o.id, label: o.name }));

/** Compact multi-select with chips (used for applicability rules and HR scopes). */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Any',
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="relative space-y-1.5" ref={ref}>
      <span id={id} className="block text-sm font-medium text-slate-700">
        {label}
      </span>
      <button
        type="button"
        aria-labelledby={id}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 w-full items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-left shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
      >
        <span className="flex flex-1 flex-wrap gap-1">
          {selected.length === 0 && <span className="px-1 text-sm text-slate-400">{placeholder}</span>}
          {selected.map((o) => (
            <span key={o.value} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
              {o.label}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${o.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.value);
                }}
                className="text-brand-400 hover:text-brand-700"
              >
                <X className="size-3" />
              </span>
            </span>
          ))}
        </span>
        <ChevronDown className="size-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <ul role="listbox" aria-multiselectable className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No options yet</li>}
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={value.includes(o.value)}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {o.label}
                {value.includes(o.value) && <Check className="size-4 text-brand-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Darwinbox-style "applies to" rules: every filled criterion must match; empty = everyone. */
export function AppliesToEditor({ value, onChange }: { value: AppliesTo; onChange: (v: AppliesTo) => void }) {
  const { data } = useLookups();
  const v = { ...EMPTY_APPLIES_TO, ...value };
  const set = (k: keyof AppliesTo) => (ids: string[]) => onChange({ ...v, [k]: ids });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Applies to</p>
        <p className="text-xs text-slate-500">Leave everything empty to apply to all employees. When several policies match, the most specific one wins.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MultiSelect label="Locations" options={toOptions(data?.locations)} value={v.locationIds} onChange={set('locationIds')} />
        <MultiSelect label="Departments" options={toOptions(data?.departments)} value={v.departmentIds} onChange={set('departmentIds')} />
        <MultiSelect label="Business units" options={toOptions(data?.businessUnits)} value={v.businessUnitIds} onChange={set('businessUnitIds')} />
        <MultiSelect label="Grades" options={toOptions(data?.grades)} value={v.gradeIds} onChange={set('gradeIds')} />
        <MultiSelect
          label="Employee types"
          options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABELS[t] }))}
          value={v.employeeTypes}
          onChange={(ids) => onChange({ ...v, employeeTypes: ids as EmployeeType[] })}
        />
      </div>
    </div>
  );
}

/** One-line human summary of applicability rules, e.g. "Bengaluru HQ · Sales". */
export function AppliesToSummary({ value }: { value: unknown }) {
  const { data } = useLookups();
  const v = { ...EMPTY_APPLIES_TO, ...((value as Partial<AppliesTo>) ?? {}) };
  const names = (ids: string[], list?: Option[]) => ids.map((id) => list?.find((o) => o.id === id)?.name ?? '…');
  const parts = [
    ...names(v.locationIds, data?.locations),
    ...names(v.departmentIds, data?.departments),
    ...names(v.businessUnitIds, data?.businessUnits),
    ...names(v.gradeIds, data?.grades),
    ...v.employeeTypes.map((t) => EMPLOYEE_TYPE_LABELS[t]),
  ];
  if (!parts.length) return <Badge tone="brand">Everyone</Badge>;
  return (
    <span className={clsx('flex flex-wrap gap-1')}>
      {parts.slice(0, 4).map((p, i) => (
        <Badge key={i}>{p}</Badge>
      ))}
      {parts.length > 4 && <Badge>+{parts.length - 4}</Badge>}
    </span>
  );
}
