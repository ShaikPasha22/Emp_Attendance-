import 'leaflet/dist/leaflet.css';
import type { LiveMapEmployee, LiveMapResponse } from '@app/shared';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

/** Employee with a location (only these are drawn). */
export type Pinned = LiveMapEmployee & { lastPunch: NonNullable<LiveMapEmployee['lastPunch']> };

export interface FitRequest {
  bounds: [number, number][];
  nonce: number;
}

interface Props {
  employees: Pinned[];
  offices: LiveMapResponse['offices'];
  fit: FitRequest | null;
  focus: { id: string; nonce: number } | null;
  /** user ids updated in the last few seconds — their pins pulse */
  recent: Set<string>;
  timezone: string;
}

const INDIA: [number, number][] = [
  [6.5, 68.0],
  [35.5, 97.5],
];
/** Pins closer than this (screen pixels) are grouped into one numbered bubble. */
const CLUSTER_PX = 46;
/** Names are printed next to pins from this zoom level (city level) upwards. */
const LABEL_ZOOM = 11;
/** From street level up, never group: show every person, stacking labels of people standing together. */
const NO_CLUSTER_ZOOM = 16;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const shortName = (name: string) => {
  const [first, ...rest] = name.split(' ');
  return rest.length ? `${first} ${rest[rest.length - 1]![0]}.` : first!;
};
const tone = (e: Pinned) => (e.liveStatus === 'WORKING' ? 'working' : 'out');
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(iso));

function pinIcon(e: Pinned, showLabel: boolean, pulsing: boolean, stackIndex = 0) {
  const classes = ['lm-pin', `lm-${tone(e)}`, e.lastPunch.outsideOffice ? 'lm-outside' : '', pulsing ? 'lm-pulse' : ''].join(' ');
  // People at (almost) the same spot get their pins fanned out vertically so every name is readable.
  const style = stackIndex ? ` style="transform: translate(-7px, ${-7 + stackIndex * 22}px)"` : '';
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="${classes}"${style}><span class="lm-dot"></span>${showLabel ? `<span class="lm-label">${esc(shortName(e.name))}</span>` : ''}</div>`,
  });
}

function clusterIcon(count: number, working: number, pulsing: boolean) {
  const size = count < 10 ? 34 : count < 100 ? 40 : 48;
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="lm-cluster ${working ? 'lm-cluster-working' : ''} ${pulsing ? 'lm-pulse' : ''}" style="width:${size}px;height:${size}px">${count}</div>`,
  });
}

export default function LiveMap({ employees, offices, fit, focus, recent, timezone }: Props) {
  return (
    <MapContainer bounds={INDIA} scrollWheelZoom className="h-full w-full" style={{ zIndex: 0 }} worldCopyJump>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      {offices.map((o) => (
        <Circle key={o.id} center={[o.latitude, o.longitude]} radius={o.radiusMeters} pathOptions={{ color: '#4f46e5', weight: 1.5, fillOpacity: 0.08, dashArray: '4 4' }}>
          <Tooltip>{o.name} — office area ({o.radiusMeters} m)</Tooltip>
        </Circle>
      ))}
      <Pins employees={employees} focus={focus} recent={recent} timezone={timezone} />
      <Fitter fit={fit} />
    </MapContainer>
  );
}

/** Clusters pins by screen distance at the current zoom; recomputed on every zoom / pan. */
function Pins({ employees, focus, recent, timezone }: Omit<Props, 'offices' | 'fit'>) {
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), key: 0 }));
  useMapEvents({ zoomend: () => setView((v) => ({ zoom: map.getZoom(), key: v.key + 1 })), moveend: () => setView((v) => ({ zoom: map.getZoom(), key: v.key + 1 })) });

  const groups = useMemo(() => {
    const cells = new Map<string, Pinned[]>();
    for (const e of employees) {
      const pt = map.project([e.lastPunch.latitude, e.lastPunch.longitude], view.zoom);
      const key = `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`;
      cells.set(key, [...(cells.get(key) ?? []), e]);
    }
    return [...cells.values()];
     
  }, [employees, view.zoom, map]);

  // Fly to an employee chosen from the side list.
  useEffect(() => {
    if (!focus) return;
    const e = employees.find((x) => x.id === focus.id);
    if (e) map.flyTo([e.lastPunch.latitude, e.lastPunch.longitude], Math.max(map.getZoom(), 16), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const single = (e: Pinned, stackIndex = 0) => {
    const p = e.lastPunch;
    return (
      <Marker
        key={e.id}
        position={[p.latitude, p.longitude]}
        icon={pinIcon(e, view.zoom >= LABEL_ZOOM || focus?.id === e.id, recent.has(e.id), stackIndex)}
        zIndexOffset={e.liveStatus === 'WORKING' ? 1000 : 0}
      >
        <Tooltip direction="top" offset={[0, -10]}>
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold">{e.name}</p>
            <p>
              {e.liveStatus === 'WORKING' ? 'Working' : 'Clocked out'} · {p.type === 'IN' ? 'in' : 'out'} at {fmtTime(p.at, timezone)}
            </p>
            <p className="max-w-56 whitespace-normal text-slate-500">{p.address ?? 'Address pending…'}</p>
          </div>
        </Tooltip>
      </Marker>
    );
  };

  return (
    <>
      {groups.map((g) => {
        if (view.zoom >= NO_CLUSTER_ZOOM) return g.map((e, i) => single(e, i));
        if (g.length === 1) return single(g[0]!);
        const lat = g.reduce((s, e) => s + e.lastPunch.latitude, 0) / g.length;
        const lng = g.reduce((s, e) => s + e.lastPunch.longitude, 0) / g.length;
        const working = g.filter((e) => e.liveStatus === 'WORKING').length;
        return (
          <Marker
            key={g.map((e) => e.id).join(',')}
            position={[lat, lng]}
            icon={clusterIcon(g.length, working, g.some((e) => recent.has(e.id)))}
            zIndexOffset={2000}
            eventHandlers={{
              click: () => map.fitBounds(L.latLngBounds(g.map((e) => [e.lastPunch.latitude, e.lastPunch.longitude] as [number, number])), { padding: [60, 60], maxZoom: 17 }),
            }}
          >
            <Tooltip direction="top" offset={[0, -16]}>
              <div className="text-xs">
                <p className="font-semibold">
                  {g.length} people · {working} working
                </p>
                <p className="text-slate-500">{g.slice(0, 8).map((e) => shortName(e.name)).join(', ')}{g.length > 8 ? ` +${g.length - 8} more` : ''}</p>
                <p className="mt-0.5 text-slate-400">Click to zoom in</p>
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

/** Applies country / state / "fit all" requests from the toolbar; also fixes sizing on mount. */
function Fitter({ fit }: { fit: FitRequest | null }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (!fit) return;
    const bounds = fit.bounds.length ? fit.bounds : INDIA;
    if (bounds.length === 1) map.flyTo(bounds[0]!, 15, { duration: 0.8 });
    else map.flyToBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 15, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.nonce]);
  return null;
}

export { INDIA };
