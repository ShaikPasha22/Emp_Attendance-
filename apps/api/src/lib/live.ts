import { EventEmitter } from 'node:events';

/**
 * In-process event hub for real-time updates (live map). Each clock-in / clock-out — and each
 * address that finishes resolving — is published here and pushed to connected dashboards over SSE.
 *
 * The free Render plan runs a single instance, so an in-memory bus is enough. If the API is ever
 * scaled to several instances, swap this for Postgres LISTEN/NOTIFY (on a direct, non-pooled
 * connection) or Redis pub/sub — the publish/subscribe interface stays the same.
 */
export interface PunchEvent {
  kind: 'punch' | 'punch-updated';
  userId: string;
  businessUnitId: string | null;
  locationId: string | null;
  at: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function publishPunch(event: PunchEvent) {
  bus.emit('punch', event);
}

export function subscribePunches(listener: (e: PunchEvent) => void) {
  bus.on('punch', listener);
  return () => bus.off('punch', listener);
}

export const liveSubscriberCount = () => bus.listenerCount('punch');
