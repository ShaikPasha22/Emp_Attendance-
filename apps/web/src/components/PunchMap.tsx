import 'leaflet/dist/leaflet.css';
import type { OfficeInfo } from '@app/shared';
import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';

export interface MapPoint {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  kind: 'IN' | 'OUT' | 'ME';
  label: string;
}

const COLORS = { IN: '#059669', OUT: '#dc2626', ME: '#2563eb' };

/**
 * Read-only map of the office geo-fence and where each clock-in / clock-out happened.
 * Loaded lazily so Leaflet stays out of the main bundle.
 */
export default function PunchMap({ office, points, className }: { office: OfficeInfo | null; points: MapPoint[]; className?: string }) {
  const officePos: [number, number] | null = office?.latitude != null && office.longitude != null ? [office.latitude, office.longitude] : null;
  const center = officePos ?? (points[0] ? [points[0].latitude, points[0].longitude] : [12.9716, 77.5946]);
  return (
    <MapContainer center={center as [number, number]} zoom={16} scrollWheelZoom={false} className={className ?? 'h-56 w-full rounded-xl border border-slate-200'} style={{ zIndex: 0 }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      {officePos && (
        <Circle center={officePos} radius={office!.radiusMeters} pathOptions={{ color: '#4f46e5', weight: 2, fillOpacity: 0.1, dashArray: '4 4' }}>
          <Tooltip>{office!.name} — allowed area ({office!.radiusMeters} m)</Tooltip>
        </Circle>
      )}
      {points.map((p, i) => (
        <PointMarker key={i} point={p} />
      ))}
      <FitBounds officePos={officePos} radius={office?.radiusMeters ?? 0} points={points} />
    </MapContainer>
  );
}

function PointMarker({ point: p }: { point: MapPoint }) {
  const pos: [number, number] = [p.latitude, p.longitude];
  return (
    <>
      {p.accuracy != null && p.accuracy > 5 && (
        <Circle center={pos} radius={p.accuracy} pathOptions={{ color: COLORS[p.kind], weight: 1, fillOpacity: 0.08 }} />
      )}
      <CircleMarker center={pos} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: COLORS[p.kind], fillOpacity: 1 }}>
        <Tooltip>{p.label}</Tooltip>
      </CircleMarker>
    </>
  );
}

/** Zooms to show the office area and every point; also fixes sizing inside dialogs. */
function FitBounds({ officePos, radius, points }: { officePos: [number, number] | null; radius: number; points: MapPoint[] }) {
  const map = useMap();
  const key = JSON.stringify([officePos, radius, points.map((p) => [p.latitude, p.longitude])]);
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize();
      const coords: [number, number][] = points.map((p) => [p.latitude, p.longitude]);
      if (officePos) {
        // Include the geo-fence edge (approx. metres → degrees).
        const d = radius / 111_000;
        coords.push([officePos[0] + d, officePos[1] + d], [officePos[0] - d, officePos[1] - d]);
      }
      if (coords.length >= 2) map.fitBounds(coords, { padding: [24, 24], maxZoom: 17 });
      else if (coords.length === 1) map.setView(coords[0]!, 16);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}
