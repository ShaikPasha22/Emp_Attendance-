import { PERMISSIONS } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Crosshair, MapPin, Network, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { lazy, Suspense, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Banner, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Display';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Input, Textarea, Toggle } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { pluralize } from '../../lib/format';

const LocationMap = lazy(() => import('./LocationMap'));

const COMMON_TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'];

interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  timezone: string;
  allowedIps: string[];
  isActive: boolean;
  _count?: { users: number };
}

interface FormState {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  timezone: string;
  allowedIps: string;
  isActive: boolean;
}

const toForm = (r: LocationRow | null): FormState => ({
  name: r?.name ?? '',
  address: r?.address ?? '',
  latitude: r?.latitude == null ? '' : String(r.latitude),
  longitude: r?.longitude == null ? '' : String(r.longitude),
  radiusMeters: String(r?.radiusMeters ?? 200),
  timezone: r?.timezone ?? 'Asia/Kolkata',
  allowedIps: (r?.allowedIps ?? []).join('\n'),
  isActive: r?.isActive ?? true,
});

/** Parses a coordinate text field; null when empty or not a finite number. */
const coord = (s: string) => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const parseIps = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export default function LocationsPage() {
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LocationRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LocationRow | null>(null);
  const q = useQuery({ queryKey: ['setup', 'locations'], queryFn: () => api.get<LocationRow[]>('/admin/setup/locations') });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/setup/locations/${id}`),
    onSuccess: () => {
      toast.success('Location deleted');
      qc.invalidateQueries({ queryKey: ['setup', 'locations'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      setDeleting(null);
    },
    onError: (err) => {
      toast.error('Could not delete', errorMessage(err));
      setDeleting(null);
    },
  });

  return (
    <div>
      <PageHeader
        title="Locations"
        description="Office sites with their geo-fence, timezone and office network. Employees assigned to a location clock in against these rules."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add location
            </Button>
          )
        }
      />

      {q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState
            icon={<MapPin className="size-6" />}
            title="No locations yet"
            description="Add your offices so clock-ins can be checked against their location and network."
            action={
              canEdit && (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                  Add location
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((loc) => (
            <li key={loc.id}>
              <LocationCard loc={loc} canEdit={canEdit} onEdit={() => setEditing(loc)} onDelete={() => setDeleting(loc)} />
            </li>
          ))}
        </ul>
      )}

      <LocationDialog row={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        tone="danger"
        title="Delete location?"
        message={
          <>
            <span className="font-medium text-slate-900">{deleting?.name}</span> will be removed permanently. If employees are still assigned, mark it inactive instead.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function LocationCard({ loc, canEdit, onEdit, onDelete }: { loc: LocationRow; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const hasGeo = loc.latitude !== null && loc.longitude !== null;
  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-slate-900">{loc.name}</h2>
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{loc.address || 'No address'}</p>
        </div>
        {canEdit && (
          <div className="-mt-1 -mr-2 flex shrink-0">
            <IconButton label={`Edit ${loc.name}`} onClick={onEdit}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label={`Delete ${loc.name}`} onClick={onDelete} className="hover:bg-red-50 hover:text-red-600">
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <div className="mt-3 mb-auto flex flex-wrap gap-1.5">
        {loc.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
        {hasGeo ? <Badge tone="blue">{loc.radiusMeters} m geo-fence</Badge> : <Badge tone="amber">No geo-fence</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <div className="flex min-w-0 items-center gap-1.5" title="Timezone">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          <dt className="sr-only">Timezone</dt>
          <dd className="truncate">{loc.timezone}</dd>
        </div>
        <div className="flex items-center gap-1.5" title="Office network IPs">
          <Network className="size-3.5 shrink-0" aria-hidden />
          <dt className="sr-only">Office IPs</dt>
          <dd>{pluralize(loc.allowedIps.length, 'IP')}</dd>
        </div>
        <div className="flex items-center gap-1.5" title="Employees">
          <Users className="size-3.5 shrink-0" aria-hidden />
          <dt className="sr-only">Employees</dt>
          <dd>{pluralize(loc._count?.users ?? 0, 'employee')}</dd>
        </div>
      </dl>
    </Card>
  );
}

function LocationDialog({ row, onClose }: { row: LocationRow | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const existing = row && row !== 'new' ? row : null;
  const [form, setForm] = useState<FormState>(toForm(null));
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [openedFor, setOpenedFor] = useState<LocationRow | 'new' | null>(null);

  if (row !== openedFor) {
    setOpenedFor(row);
    setForm(toForm(existing));
    setError(null);
  }

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lat = coord(form.latitude);
  const lng = coord(form.longitude);
  const radius = Number(form.radiusMeters);
  const validRadius = Number.isInteger(radius) && radius >= 20 && radius <= 10000;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        latitude: lat,
        longitude: lng,
        radiusMeters: radius,
        timezone: form.timezone.trim(),
        allowedIps: parseIps(form.allowedIps),
        isActive: form.isActive,
      };
      return existing ? api.put(`/admin/setup/locations/${existing.id}`, body) : api.post('/admin/setup/locations', body);
    },
    onSuccess: () => {
      toast.success(existing ? 'Location updated' : 'Location added');
      qc.invalidateQueries({ queryKey: ['setup', 'locations'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if ((form.latitude.trim() && lat === null) || (form.longitude.trim() && lng === null)) return setError('Latitude and longitude must be numbers.');
    if ((lat === null) !== (lng === null)) return setError('Set both latitude and longitude, or leave both empty.');
    if (!validRadius) return setError('Radius must be a whole number between 20 and 10,000 metres.');
    save.mutate();
  };

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Location unavailable', 'This browser does not support geolocation.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setForm((f) => ({ ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }));
        if (p.coords.accuracy > 100) toast.warning('Location is approximate', `Accuracy is about ${Math.round(p.coords.accuracy)} m. Fine-tune the pin on the map.`);
      },
      (err) => {
        setLocating(false);
        toast.error('Could not get your location', err.code === err.PERMISSION_DENIED ? 'Allow location access in your browser and try again.' : err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit location' : 'Add location'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" loading={save.isPending} disabled={!form.name.trim() || !form.timezone.trim()}>
            {existing ? 'Save changes' : 'Add location'}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={submit} className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required maxLength={100} value={form.name} onChange={set('name')} placeholder="e.g. Bengaluru HQ" data-autofocus />
          <Input label="Timezone" required list="location-timezones" value={form.timezone} onChange={set('timezone')} hint="IANA name, e.g. Asia/Kolkata." />
          <datalist id="location-timezones">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </div>
        <Input label="Address" maxLength={300} value={form.address} onChange={set('address')} />

        <section aria-labelledby="geofence-heading" className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="geofence-heading" className="text-sm font-medium text-slate-800">
                Geo-fence
              </h3>
              <p className="text-xs text-slate-500">
                Employees must be within the radius of this point to clock in at the office. Click the map to drop the pin. Leave empty to skip the location check.
              </p>
            </div>
            <Button size="sm" variant="secondary" icon={<Crosshair className="size-4" />} loading={locating} onClick={locateMe} className="shrink-0">
              Use my current location
            </Button>
          </div>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl sm:h-72" />}>
            <LocationMap
              latitude={lat}
              longitude={lng}
              radiusMeters={validRadius ? radius : 200}
              onPick={(la, ln) => setForm((f) => ({ ...f, latitude: String(la), longitude: String(ln) }))}
            />
          </Suspense>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Input label="Latitude" inputMode="decimal" value={form.latitude} onChange={set('latitude')} placeholder="12.9716" />
            <Input label="Longitude" inputMode="decimal" value={form.longitude} onChange={set('longitude')} placeholder="77.5946" />
            <Input
              label="Radius (m)"
              type="number"
              inputMode="numeric"
              required
              min={20}
              max={10000}
              step={10}
              value={form.radiusMeters}
              onChange={set('radiusMeters')}
              hint="Allowed clock-in distance."
              className="col-span-2 sm:col-span-1"
            />
          </div>
          {(lat !== null || lng !== null) && (
            <button
              type="button"
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
              onClick={() => setForm((f) => ({ ...f, latitude: '', longitude: '' }))}
            >
              Clear pin
            </button>
          )}
        </section>

        <Textarea
          label="Office network IPs"
          rows={3}
          value={form.allowedIps}
          onChange={set('allowedIps')}
          placeholder={'203.0.113.10\n203.0.113.0/24'}
          hint="One per line or comma separated. IP addresses or CIDR ranges used by the office-network restriction."
        />
        <Toggle
          label="Active"
          description="Inactive locations stay on existing employees but can't be picked for new ones."
          checked={form.isActive}
          onChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
        />
      </form>
    </Dialog>
  );
}
