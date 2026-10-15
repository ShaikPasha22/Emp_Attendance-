import type { GeoPoint } from '@app/shared';

type GeoErrorCode = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED';

const MESSAGES: Record<GeoErrorCode, string> = {
  DENIED: 'Location permission is blocked. Allow location for this site in your browser settings, then try again.',
  TIMEOUT: 'Getting your location took too long. Move near a window and try again.',
  UNAVAILABLE: 'Your location is unavailable. Turn on location services and try again.',
  UNSUPPORTED: 'This browser does not support location.',
};

export class GeoError extends Error {
  constructor(public code: GeoErrorCode) {
    super(MESSAGES[code]);
  }
}

/**
 * Current position with high accuracy. Keeps listening briefly for a better fix when the first one
 * is coarse, which noticeably improves indoor accuracy on phones.
 */
export function getCurrentPosition(targetAccuracy = 50, maxWaitMs = 8000): Promise<GeoPoint> {
  if (!('geolocation' in navigator)) return Promise.reject(new GeoError('UNSUPPORTED'));
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let done = false;
    const finish = (code?: GeoErrorCode) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) {
        resolve({
          latitude: best.coords.latitude,
          longitude: best.coords.longitude,
          accuracy: best.coords.accuracy,
          // Age of the reading on this device; the server rejects stale (cached) positions.
          ageMs: Math.max(0, Date.now() - best.timestamp),
        });
      } else {
        reject(new GeoError(code ?? 'UNAVAILABLE'));
      }
    };
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= targetAccuracy) finish();
      },
      (err) => finish(err.code === err.PERMISSION_DENIED ? 'DENIED' : err.code === err.TIMEOUT ? 'TIMEOUT' : 'UNAVAILABLE'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    const timer = setTimeout(() => finish('TIMEOUT'), maxWaitMs);
  });
}

/** Distance in metres (haversine) — used to show "inside / outside office" before clocking in. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
