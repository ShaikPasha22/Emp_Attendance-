import { env } from '../config/env';
import { publishPunch } from './live';
import { logger } from './logger';
import { prisma } from './prisma';

/**
 * Turns punch coordinates into a readable place name ("MG Road, Shanthala Nagar, Bengaluru").
 *
 * - Punches inside the office geo-fence are named after the office (no lookup at all).
 * - Other punches are looked up in the background so clocking in is never slowed down.
 * - Results are cached by coordinates rounded to ~11 m, so repeat spots cost nothing.
 * - Lookups are spaced ≥ 1.1 s apart to respect OpenStreetMap Nominatim's usage policy.
 */

/** Google Maps link for a point — opens the exact spot in the Maps app on phones. */
export const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;

export const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

/** Shortens a long geocoder address to its most useful parts (locality first, no country/postcode noise). */
export function shortenAddress(full: string): string {
  const parts = full
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^\d{5,6}$/.test(p) && p.toLowerCase() !== 'india');
  return parts.slice(0, 5).join(', ');
}

export interface Place {
  address: string;
  state: string | null;
  country: string | null;
}

interface GeocoderBody {
  display_name?: string;
  address?: { state?: string; region?: string; state_district?: string; country?: string };
  results?: { formatted?: string; state?: string; country?: string }[];
}

async function lookup(lat: number, lng: number): Promise<Place | null> {
  const ua = `AttendancePortal/1.0${env.GEOCODER_CONTACT_EMAIL ? ` (${env.GEOCODER_CONTACT_EMAIL})` : ''}`;
  const signal = AbortSignal.timeout(8000);
  let url: string;
  switch (env.GEOCODER) {
    case 'nominatim':
      url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1${env.GEOCODER_CONTACT_EMAIL ? `&email=${encodeURIComponent(env.GEOCODER_CONTACT_EMAIL)}` : ''}`;
      break;
    case 'locationiq':
      url = `https://us1.locationiq.com/v1/reverse?key=${env.GEOCODER_API_KEY}&lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`;
      break;
    case 'geoapify':
      url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&format=json&apiKey=${env.GEOCODER_API_KEY}`;
      break;
    default:
      return null;
  }
  const res = await fetch(url, { headers: { 'user-agent': ua, 'accept-language': 'en' }, signal });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  const body = (await res.json()) as GeocoderBody;
  const name = body.display_name ?? body.results?.[0]?.formatted;
  if (!name) return null;
  return {
    address: shortenAddress(name),
    // '' marks "looked up, no state found" so the retry job doesn't keep asking.
    state: body.address?.state ?? body.address?.region ?? body.results?.[0]?.state ?? '',
    country: body.address?.country ?? body.results?.[0]?.country ?? null,
  };
}

/** Cached reverse geocoding. Returns null when disabled or the lookup fails. */
export async function reverseGeocode(lat: number, lng: number): Promise<Place | null> {
  if (env.GEOCODER === 'none') return null;
  const key = cacheKey(lat, lng);
  const cached = await prisma.geocodeCache.findUnique({ where: { key } });
  if (cached && cached.state !== null) return { address: cached.address, state: cached.state, country: cached.country };
  const place = await throttled(() => lookup(lat, lng));
  if (place) {
    await prisma.geocodeCache.upsert({
      where: { key },
      create: { key, ...place, provider: env.GEOCODER },
      update: { state: place.state, country: place.country },
    });
  }
  return place;
}

// ---- Serial queue: one external lookup at a time, ≥ 1.1 s apart ----
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Fills in the address (and state / country) of one punch, then notifies live dashboards. */
export async function geocodePunch(punchId: string): Promise<void> {
  const punch = await prisma.attendancePunch.findUnique({
    where: { id: punchId },
    include: {
      record: {
        select: {
          user: {
            select: {
              id: true,
              businessUnitId: true,
              locationId: true,
              location: { select: { name: true, radiusMeters: true, latitude: true, longitude: true } },
            },
          },
        },
      },
    },
  });
  if (!punch || punch.latitude == null || punch.longitude == null) return;
  if (punch.address && punch.state) return;
  const user = punch.record.user;
  const office = user.location;
  const atOffice = !!office && punch.distanceMeters != null && punch.distanceMeters <= office.radiusMeters;
  const data: { address?: string; addressSource?: string; state?: string | null; country?: string | null } = {};
  if (atOffice && !punch.address) Object.assign(data, { address: office.name, addressSource: 'OFFICE' });

  try {
    // Inside the office, the region comes from the office's own coordinates (one cached lookup per office).
    const lat = atOffice && office.latitude != null ? office.latitude : punch.latitude;
    const lng = atOffice && office.longitude != null ? office.longitude : punch.longitude;
    const place = await reverseGeocode(lat, lng);
    if (place) {
      if (!atOffice && !punch.address) Object.assign(data, { address: place.address, addressSource: 'GEOCODER' });
      Object.assign(data, { state: place.state, country: place.country });
    }
  } catch (err) {
    // The hourly job retries anything still missing an address.
    logger.warn({ err, punchId }, 'Reverse geocoding failed');
  }
  if (Object.keys(data).length === 0) return;
  await prisma.attendancePunch.update({ where: { id: punchId }, data });
  publishPunch({ kind: 'punch-updated', userId: user.id, businessUnitId: user.businessUnitId, locationId: user.locationId, at: new Date().toISOString() });
}

/** Fire-and-forget wrapper used by the clock-in / clock-out handlers. */
export function queueGeocode(punchId: string) {
  if (env.GEOCODER === 'none') return;
  void geocodePunch(punchId).catch((err) => logger.warn({ err, punchId }, 'Background geocoding failed'));
}

/** Job: retry punches that still have no address (e.g. lookups lost to a restart or an outage). */
export async function geocodePending(limit = 40) {
  const pending = await prisma.attendancePunch.findMany({
    where: {
      OR: [{ address: null }, ...(env.GEOCODER === 'none' ? [] : [{ state: null }])],
      latitude: { not: null },
      longitude: { not: null },
      at: { gt: new Date(Date.now() - 30 * 86_400_000) },
    },
    orderBy: { at: 'desc' },
    take: limit,
    select: { id: true },
  });
  for (const p of pending) await geocodePunch(p.id);
  return { attempted: pending.length };
}
