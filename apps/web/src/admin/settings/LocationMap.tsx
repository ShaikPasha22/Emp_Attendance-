import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru

interface Props {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onPick: (latitude: number, longitude: number) => void;
}

/** Interactive geo-fence picker. Loaded lazily so Leaflet stays out of the main bundle. */
export default function LocationMap({ latitude, longitude, radiusMeters, onPick }: Props) {
  const pos: [number, number] | null = latitude !== null && longitude !== null ? [latitude, longitude] : null;
  return (
    <MapContainer
      center={pos ?? DEFAULT_CENTER}
      zoom={pos ? 16 : 12}
      scrollWheelZoom={false}
      className="h-64 w-full rounded-xl border border-slate-200 sm:h-72"
      style={{ zIndex: 0 }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <ClickHandler onPick={onPick} />
      <Recenter pos={pos} />
      {pos && (
        <>
          <Circle center={pos} radius={radiusMeters} pathOptions={{ color: '#4f46e5', weight: 2, fillOpacity: 0.12 }} />
          <CircleMarker center={pos} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1 }} />
        </>
      )}
    </MapContainer>
  );
}

function ClickHandler({ onPick }: { onPick: Props['onPick'] }) {
  useMapEvents({
    click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))),
  });
  return null;
}

/** Fixes sizing inside dialogs and follows coordinates typed in or taken from GPS. */
function Recenter({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [map]);
  const lat = pos?.[0];
  const lng = pos?.[1];
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    // Only move when the pin is off-screen, so clicking to fine-tune doesn't jump the view.
    if (!map.getBounds().contains([lat, lng]) || map.getZoom() < 14) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [map, lat, lng]);
  return null;
}
