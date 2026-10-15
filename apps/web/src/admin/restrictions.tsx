import {
  ENFORCEMENT_MODE_LABELS,
  type AttendanceRestrictions,
  type AttendanceRestrictionsPatch,
  type EnforcementMode,
} from '@app/shared';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Badge } from '../components/ui/Display';
import { Input, Segmented, Toggle } from '../components/ui/Field';

const MODES: { value: EnforcementMode; label: string }[] = (['OFF', 'FLAG', 'BLOCK'] as const).map((m) => ({ value: m, label: ENFORCEMENT_MODE_LABELS[m] }));

type Key = keyof AttendanceRestrictions;

interface Props {
  /** Full settings (company default) or a partial patch (policy / employee override). */
  value: AttendanceRestrictionsPatch;
  onChange: (v: AttendanceRestrictionsPatch) => void;
  /** When set, the form edits a patch: each row can inherit or override this base value. */
  inherited?: AttendanceRestrictions;
  disabled?: boolean;
}

interface RowProps {
  k: Key;
  title: string;
  description: ReactNode;
  inheritedText: string;
  children: ReactNode;
  phase2?: boolean;
  partial: boolean;
  disabled?: boolean;
  isSet: (k: Key) => boolean;
  setOverride: (k: Key, on: boolean) => void;
}

/** Defined outside the editor so inputs keep focus while typing (no remount per render). */
function RestrictionRow({ k, title, description, inheritedText, children, phase2, partial, disabled, isSet, setOverride }: RowProps) {
  const active = !partial || isSet(k);
  return (
    <div className={clsx('py-4', phase2 && 'opacity-70')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:max-w-md">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
            {title}
            {phase2 && <Badge tone="purple">Coming in Phase 2</Badge>}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        </div>
        {partial && !phase2 && (
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" className="size-4 accent-brand-600" checked={isSet(k)} onChange={(e) => setOverride(k, e.target.checked)} disabled={disabled} />
            Override
          </label>
        )}
      </div>
      <div className="mt-3">
        {active ? (
          children
        ) : (
          <p className="text-sm text-slate-500">
            Inherits: <span className="font-medium text-slate-700">{inheritedText}</span>
          </p>
        )}
      </div>
    </div>
  );
}

const describeMode = (m: EnforcementMode) => ENFORCEMENT_MODE_LABELS[m];

/**
 * One editor for every attendance restriction. Used for the company default (full),
 * restriction policies and individual employee overrides (partial, with "inherit").
 */
export function AttendanceRestrictionFields({ value, onChange, inherited, disabled }: Props) {
  const partial = !!inherited;
  const effective = { ...(inherited ?? {}), ...value } as AttendanceRestrictions;
  const isSet = (k: Key) => value[k] !== undefined;
  const update = <K extends Key>(k: K, v: AttendanceRestrictions[K]) => onChange({ ...value, [k]: v });
  const setOverride = (k: Key, on: boolean) => {
    const next = { ...value } as Record<string, unknown>;
    if (on) next[k] = inherited![k];
    else delete next[k];
    onChange(next as AttendanceRestrictionsPatch);
  };

  const base = inherited;
  const rowProps = { partial, disabled, isSet, setOverride };
  return (
    <div className="divide-y divide-slate-100">
      <RestrictionRow {...rowProps} k="geoCapture" title="Capture location" description="Record GPS coordinates at clock-in and clock-out." inheritedText={base?.geoCapture ? 'On' : 'Off'}>
        <Toggle label="Require location to clock in/out" checked={effective.geoCapture} onChange={(v) => update('geoCapture', v)} disabled={disabled} />
      </RestrictionRow>

      <RestrictionRow
        {...rowProps}
        k="geofenceMode"
        title="Office geo-fence"
        description="What happens when someone is outside their office radius (set on each location)."
        inheritedText={base ? describeMode(base.geofenceMode) : ''}
      >
        <Segmented<EnforcementMode> label="Geo-fence mode" value={effective.geofenceMode} onChange={(v) => update('geofenceMode', v)} options={MODES} disabled={disabled} />
      </RestrictionRow>

      <RestrictionRow {...rowProps} k="maxAccuracyMeters" title="GPS accuracy limit" description="Reject imprecise readings (e.g. indoors with weak GPS)." inheritedText={base ? `${base.maxAccuracyMeters} m` : ''}>
        <Input
          type="number"
          min={10}
          max={5000}
          aria-label="Maximum accuracy in metres"
          className="max-w-40"
          value={effective.maxAccuracyMeters}
          onChange={(e) => update('maxAccuracyMeters', Math.max(10, Number(e.target.value) || 10))}
          hint="metres"
          disabled={disabled}
        />
      </RestrictionRow>

      <RestrictionRow
        {...rowProps}
        k="remoteClockInOnApprovedRequests"
        title="Remote clock-in on approved days"
        description="Skip the geo-fence and network checks when WFH or On-duty is approved."
        inheritedText={base?.remoteClockInOnApprovedRequests ? 'On' : 'Off'}
      >
        <Toggle label="Allow remote clock-in" checked={effective.remoteClockInOnApprovedRequests} onChange={(v) => update('remoteClockInOnApprovedRequests', v)} disabled={disabled} />
      </RestrictionRow>

      <RestrictionRow
        {...rowProps}
        k="clockInWindow"
        title="Clock-in time window"
        description="Only allow clock-in between these hours."
        inheritedText={base ? (base.clockInWindow.enabled ? `${base.clockInWindow.start} – ${base.clockInWindow.end}` : 'Off') : ''}
      >
        <div className="space-y-3">
          <Toggle label="Restrict clock-in hours" checked={effective.clockInWindow.enabled} onChange={(v) => update('clockInWindow', { ...effective.clockInWindow, enabled: v })} disabled={disabled} />
          {effective.clockInWindow.enabled && (
            <div className="grid max-w-xs grid-cols-2 gap-3">
              <Input label="From" type="time" value={effective.clockInWindow.start} onChange={(e) => update('clockInWindow', { ...effective.clockInWindow, start: e.target.value })} disabled={disabled} />
              <Input label="To" type="time" value={effective.clockInWindow.end} onChange={(e) => update('clockInWindow', { ...effective.clockInWindow, end: e.target.value })} disabled={disabled} />
            </div>
          )}
        </div>
      </RestrictionRow>

      <RestrictionRow
        {...rowProps}
        k="deviceBinding"
        title="Device binding"
        description="Only allow clock-in from registered devices. The first device used is registered automatically; HR can reset it."
        inheritedText={base ? (base.deviceBinding.enabled ? `On (${base.deviceBinding.maxDevices} device${base.deviceBinding.maxDevices > 1 ? 's' : ''})` : 'Off') : ''}
      >
        <div className="space-y-3">
          <Toggle label="Bind to device" checked={effective.deviceBinding.enabled} onChange={(v) => update('deviceBinding', { ...effective.deviceBinding, enabled: v })} disabled={disabled} />
          {effective.deviceBinding.enabled && (
            <Input
              label="Devices allowed per employee"
              type="number"
              min={1}
              max={5}
              className="max-w-40"
              value={effective.deviceBinding.maxDevices}
              onChange={(e) => update('deviceBinding', { ...effective.deviceBinding, maxDevices: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
              disabled={disabled}
            />
          )}
        </div>
      </RestrictionRow>

      <RestrictionRow
        {...rowProps}
        k="ipRestrictionMode"
        title="Office network (IP / Wi-Fi)"
        description="Check the connection against each location’s allowed IP addresses. Locations without IPs are not checked."
        inheritedText={base ? describeMode(base.ipRestrictionMode) : ''}
      >
        <Segmented<EnforcementMode> label="Network restriction mode" value={effective.ipRestrictionMode} onChange={(v) => update('ipRestrictionMode', v)} options={MODES} disabled={disabled} />
      </RestrictionRow>

      <RestrictionRow {...rowProps} k="selfieRequired" title="Selfie on clock-in" description="Capture a photo with each punch (stored in Supabase Storage)." inheritedText="Off" phase2>
        <Toggle label="Require selfie" checked={false} onChange={() => {}} disabled />
      </RestrictionRow>
    </div>
  );
}
