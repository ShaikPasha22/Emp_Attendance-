import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { invalidatePolicies } from '../src/engine/context';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/crypto';
import { invalidateCompanySettings } from '../src/lib/settings';

const app = createApp();
const api = request(app);
const AT_OFFICE = { latitude: 12.9755, longitude: 77.6066, accuracy: 20 };
const FAR_AWAY = { latitude: 12.99, longitude: 77.62, accuracy: 20 };

// Every run creates its own uniquely named employees, so the suite never needs to wipe the database.
const RUN = Date.now().toString(36);
const PASSWORD = 'Test@12345';
const email = (tag: string) => `${tag}.${RUN}@example.com`;

async function createEmployee(tag: string, managerId?: string) {
  const [location, department, profile] = await Promise.all([
    prisma.location.findUniqueOrThrow({ where: { name: 'Bengaluru HQ' } }),
    prisma.department.findUniqueOrThrow({ where: { name: 'Engineering' } }),
    prisma.permissionProfile.findUniqueOrThrow({ where: { name: 'Employee' } }),
  ]);
  return prisma.user.create({
    data: {
      employeeCode: `T${RUN}${tag}`.slice(0, 30).toUpperCase(),
      firstName: 'Test',
      lastName: tag,
      email: email(tag),
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      locationId: location.id,
      departmentId: department.id,
      profileId: profile.id,
      managerId,
    },
  });
}

async function login(email: string, password = PASSWORD) {
  const res = await api.post('/api/v1/auth/login').send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: res.body.accessToken as string, cookie: res.headers['set-cookie'] as unknown as string[], user: res.body.user };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
/** A past weekday inside the regularization window. */
function recentWeekday(daysBack: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

let employee: string, manager: string, hr: string;

beforeAll(async () => {
  invalidateCompanySettings();
  invalidatePolicies();
  const mgr = await createEmployee('mgr');
  await createEmployee('emp', mgr.id);
  await Promise.all(['field', 'locky', 'sess'].map((t) => createEmployee(t)));
  employee = (await login(email('emp'))).token;
  manager = (await login(email('mgr'))).token;
  hr = (await login('hr@example.com', 'Demo@12345')).token;
});
afterAll(() => prisma.$disconnect());

describe('health', () => {
  it('liveness does not need the database; readiness does', async () => {
    expect((await api.get('/healthz')).status).toBe(200);
    expect((await api.get('/readyz')).body.status).toBe('ready');
  });
});

describe('authentication', () => {
  it('rejects wrong passwords with a generic message', async () => {
    const res = await api.post('/api/v1/auth/login').send({ email: email('emp'), password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks an account after repeated failures', async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await api.post('/api/v1/auth/login').send({ email: email('locky'), password: 'wrong' });
    expect(last!.status).toBe(423);
    const correct = await api.post('/api/v1/auth/login').send({ email: email('locky'), password: PASSWORD });
    expect(correct.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const { cookie } = await login(email('sess'));
    const first = await api.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    // Replaying the old cookie after the grace window must end the session.
    await prisma.session.updateMany({ where: { user: { email: email('sess') } }, data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await api.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    const next = await api.post('/api/v1/auth/refresh').set('Cookie', first.headers['set-cookie'] as unknown as string[]);
    expect(next.status).toBe(401);
  });

  it('blocks cross-site refresh requests (CSRF)', async () => {
    const { cookie } = await login(email('sess'));
    const res = await api.post('/api/v1/auth/refresh').set('Cookie', cookie).set('origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('requires a token for protected routes', async () => {
    expect((await api.get('/api/v1/me')).status).toBe(401);
  });
});

describe('sign-up and access approval', () => {
  it('keeps self sign-ups pending until HR approves them', async () => {
    const signup = await api.post('/api/v1/auth/signup').send({ firstName: 'Test', lastName: 'Joiner', email: email('joiner'), password: 'Joiner@123' });
    expect(signup.status).toBe(201);
    const blocked = await api.post('/api/v1/auth/login').send({ email: email('joiner'), password: 'Joiner@123' });
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: email('joiner') } });
    const approve = await api.post(`/api/v1/admin/employees/${user.id}/status`).set(auth(hr)).send({ action: 'APPROVE' });
    expect(approve.status).toBe(200);
    expect((await api.post('/api/v1/auth/login').send({ email: email('joiner'), password: 'Joiner@123' })).status).toBe(200);
  });

  it('enforces the password policy', async () => {
    const res = await api.post('/api/v1/auth/signup').send({ firstName: 'Weak', lastName: 'Pw', email: email('weak'), password: 'short' });
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });

  it('prevents HR from granting permissions they do not hold', async () => {
    const superAdmin = await prisma.permissionProfile.findUniqueOrThrow({ where: { name: 'Super Admin' } });
    const target = await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } });
    const res = await api.put(`/api/v1/admin/employees/${target.id}`).set(auth(hr)).send({ profileId: superAdmin.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });
});

describe('clock-in / clock-out', () => {
  it('requires location by default', async () => {
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(employee)).send({});
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });

  it('records a clock-in at the office and blocks a double clock-in', async () => {
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(employee)).send({ location: AT_OFFICE });
    expect(res.status).toBe(201);
    expect(['P', 'L']).toContain(res.body.record.status);
    expect(res.body.record.flags).not.toContain('OUTSIDE_GEOFENCE_IN');
    const again = await api.post('/api/v1/attendance/clock-in').set(auth(employee)).send({ location: AT_OFFICE });
    expect(again.status).toBe(409);
  });

  it('clocks out and computes worked minutes', async () => {
    const res = await api.post('/api/v1/attendance/clock-out').set(auth(employee)).send({ location: AT_OFFICE });
    expect(res.status).toBe(200);
    expect(res.body.record.workMinutes).toBeGreaterThanOrEqual(0);
    expect((await api.post('/api/v1/attendance/clock-out').set(auth(employee)).send({ location: AT_OFFICE })).status).toBe(409);
  });

  it('lets the employee clock in again after clocking out (first in, last out) and logs every punch', async () => {
    const again = await api.post('/api/v1/attendance/clock-in').set(auth(employee)).send({ location: { ...AT_OFFICE, latitude: AT_OFFICE.latitude + 0.00001 } });
    expect(again.status).toBe(201);
    expect(again.body.message).toMatch(/again/);
    expect(again.body.record.clockOut).toBeNull();
    const out = await api.post('/api/v1/attendance/clock-out').set(auth(employee)).send({ location: AT_OFFICE });
    expect(out.status).toBe(200);
    const day = await api.get(`/api/v1/attendance/me/day/${out.body.record.date}`).set(auth(employee));
    expect(day.body.punches.map((p: { type: string }) => p.type)).toEqual(['IN', 'OUT', 'IN', 'OUT']);
    expect(day.body.punches[0].distanceMeters).toBeLessThan(50);
    expect(day.body.office.name).toBe('Bengaluru HQ');
  });

  it('stores a readable place and map link for every punch', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const day = await api.get(`/api/v1/attendance/me/day/${date}`).set(auth(employee));
    const first = day.body.punches[0];
    // Inside the geo-fence the place is the office itself (no external lookup needed).
    expect(first.address).toBe('Bengaluru HQ');
    expect(first.mapUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=12\.97/);
    expect(day.body.record.inPlace.address).toBe('Bengaluru HQ');
  });

  it('lets managers see where their team clocked in, but not other employees', async () => {
    const emp = await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } });
    const date = new Date().toISOString().slice(0, 10);
    const today = await api.get('/api/v1/team/today').set(auth(manager));
    const member = today.body.members.find((m: { id: string }) => m.id === emp.id);
    expect(member.record.inPlace.mapUrl).toContain('google.com/maps');
    const day = await api.get(`/api/v1/team/members/${emp.id}/day/${date}`).set(auth(manager));
    expect(day.status).toBe(200);
    expect(day.body.punches.length).toBeGreaterThan(0);
    const stranger = await prisma.user.findUniqueOrThrow({ where: { email: email('field') } });
    expect((await api.get(`/api/v1/team/members/${stranger.id}/day/${date}`).set(auth(manager))).status).toBe(404);
  });

  it('rejects stale location readings', async () => {
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(manager)).send({ location: { ...AT_OFFICE, ageMs: 10 * 60_000 } });
    expect(res.body.error.code).toBe('LOCATION_STALE');
  });

  it('flags clock-ins outside the geo-fence for HR review (default mode)', async () => {
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(manager)).send({ location: FAR_AWAY });
    expect(res.status).toBe(201);
    expect(res.body.record.status).toBe('FL');
    expect(res.body.warnings.length).toBeGreaterThan(0);

    const queue = await api.get('/api/v1/admin/attendance').query({ from: res.body.record.date, to: res.body.record.date, flagged: 'true' }).set(auth(hr));
    const entry = queue.body.items.find((i: { id: string }) => i.id === res.body.record.id);
    expect(entry).toBeTruthy();
    const review = await api.post(`/api/v1/admin/attendance/${entry.id}/review`).set(auth(hr)).send({ decision: 'APPROVE' });
    expect(review.status).toBe(200);
    expect(review.body.status).not.toBe('FL');
  });

  it('blocks clock-ins outside the geo-fence when HR switches to Block', async () => {
    const current = (await api.get('/api/v1/admin/settings/attendance-restrictions').set(auth(hr))).body;
    await api.put('/api/v1/admin/settings/attendance-restrictions').set(auth(hr)).send({ ...current, geofenceMode: 'BLOCK' }).expect(200);
    const field = (await login(email('field'))).token;
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(field)).send({ location: FAR_AWAY });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTSIDE_GEOFENCE');
    await api.put('/api/v1/admin/settings/attendance-restrictions').set(auth(hr)).send(current).expect(200);
  });

  it('applies an individual override on top of company rules', async () => {
    const field = await prisma.user.findUniqueOrThrow({ where: { email: email('field') } });
    await api.put(`/api/v1/admin/employees/${field.id}/restriction-override`).set(auth(hr)).send({ settings: { geoCapture: false, geofenceMode: 'OFF' }, reason: 'Field role' }).expect(200);
    const token = (await login(email('field'))).token;
    const res = await api.post('/api/v1/attendance/clock-in').set(auth(token)).send({});
    expect(res.status).toBe(201);
  });
});

describe('requests & approval workflow', () => {
  let requestId: string;
  const date = recentWeekday(3);

  it('employee raises a correction request', async () => {
    const res = await api.post('/api/v1/requests').set(auth(employee)).send({ type: 'REGULARIZATION', date, clockIn: '09:20', clockOut: '18:40', reason: 'Forgot to clock out' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.levels.map((l: { approverType: string }) => l.approverType)).toEqual(['REPORTING_MANAGER', 'HR']);
    requestId = res.body.id;
  });

  it('rejects duplicate requests for the same date', async () => {
    const res = await api.post('/api/v1/requests').set(auth(employee)).send({ type: 'REGULARIZATION', date, clockIn: '09:00', clockOut: '18:00', reason: 'Duplicate request' });
    expect(res.status).toBe(409);
  });

  it('HR cannot skip the manager level; the employee cannot approve their own request', async () => {
    expect((await api.post(`/api/v1/requests/${requestId}/approve`).set(auth(hr)).send({})).status).toBe(403);
    expect((await api.post(`/api/v1/requests/${requestId}/approve`).set(auth(employee)).send({})).status).toBe(403);
  });

  it('manager then HR approve, and attendance is corrected', async () => {
    const inbox = await api.get('/api/v1/requests/inbox').set(auth(manager));
    expect(inbox.body.map((r: { id: string }) => r.id)).toContain(requestId);
    const lvl1 = await api.post(`/api/v1/requests/${requestId}/approve`).set(auth(manager)).send({ comment: 'ok' });
    expect(lvl1.body.status).toBe('PENDING');
    expect(lvl1.body.currentLevel).toBe(1);
    const lvl2 = await api.post(`/api/v1/requests/${requestId}/approve`).set(auth(hr)).send({});
    expect(lvl2.body.status).toBe('APPROVED');

    const emp = await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } });
    const record = await prisma.attendanceRecord.findUniqueOrThrow({ where: { userId_date: { userId: emp.id, date: new Date(`${date}T00:00:00Z`) } } });
    expect(record.source).toBe('REGULARIZED');
    expect(record.workMinutes).toBe(560);
    expect(record.status).toBe('P');
  });

  it('requires a comment to reject', async () => {
    const r = await api.post('/api/v1/requests').set(auth(employee)).send({ type: 'WFH', startDate: recentWeekday(1), endDate: recentWeekday(1), reason: 'Plumber visit at home' });
    expect((await api.post(`/api/v1/requests/${r.body.id}/reject`).set(auth(manager)).send({})).status).toBe(422);
    const ok = await api.post(`/api/v1/requests/${r.body.id}/reject`).set(auth(manager)).send({ comment: 'Team offsite that day' });
    expect(ok.body.status).toBe('REJECTED');
  });
});

describe('live map', () => {
  it('shows managers a pin for each team member who clocked in, and hides it from employees', async () => {
    const emp = await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } });
    const res = await api.get('/api/v1/admin/live-map').set(auth(manager));
    expect(res.status).toBe(200);
    const pin = res.body.employees.find((e: { id: string }) => e.id === emp.id);
    expect(pin.lastPunch.mapUrl).toContain('google.com/maps');
    expect(['WORKING', 'CLOCKED_OUT']).toContain(pin.liveStatus);
    expect(res.body.offices[0].name).toBe('Bengaluru HQ');
    expect((await api.get('/api/v1/admin/live-map').set(auth(employee))).status).toBe(403);
  });

  it('pushes a clock-in to the manager’s open map instantly (SSE)', async () => {
    const emp = await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const ctrl = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/admin/live-map/stream`, { headers: { authorization: `Bearer ${manager}` }, signal: ctrl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      const readUntil = async (needle: string) => {
        const deadline = Date.now() + 5000;
        while (!buffer.includes(needle)) {
          if (Date.now() > deadline) throw new Error(`Timed out waiting for ${needle}; got: ${buffer}`);
          const { value, done } = await reader.read();
          if (done) throw new Error('stream closed');
          buffer += value;
        }
      };
      await readUntil('event: ready');
      // Employee clocks in (again) — the manager's stream must receive it without polling.
      const punch = await api.post('/api/v1/attendance/clock-in').set(auth(employee)).send({ location: { ...AT_OFFICE, latitude: AT_OFFICE.latitude + 0.00002 } });
      expect(punch.status).toBe(201);
      await readUntil(`"userId":"${emp.id}"`);
      expect(buffer).toContain('event: punch');
    } finally {
      ctrl.abort();
      server.close();
    }
  });
});

describe('access control', () => {
  it('employees cannot reach the dashboard APIs', async () => {
    expect((await api.get('/api/v1/admin/employees').set(auth(employee))).status).toBe(403);
    expect((await api.get('/api/v1/reports/muster-roll?month=2026-01').set(auth(employee))).status).toBe(403);
  });

  it('managers see their team but not HR settings', async () => {
    expect((await api.get('/api/v1/team/today').set(auth(manager))).status).toBe(200);
    expect((await api.get('/api/v1/admin/settings/security').set(auth(manager))).status).toBe(403);
  });

  it('scheduled jobs require the job secret', async () => {
    expect((await api.post('/api/v1/internal/jobs/daily-status')).status).toBe(401);
    const ok = await api.post('/api/v1/internal/jobs/daily-status').set('x-job-secret', process.env.JOB_SECRET!);
    expect(ok.status).toBe(200);
  });

  it('every admin change is audit-logged', async () => {
    const res = await api.get('/api/v1/admin/audit').query({ entityType: 'Company' }).set(auth(hr));
    expect(res.body.items.some((i: { action: string }) => i.action === 'restrictions.updated')).toBe(true);
  });
});

describe('reports', () => {
  it('exports clock-in location names and map links', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.get(`/api/v1/reports/attendance?from=${today}&to=${today}&format=csv`).set(auth(hr));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Clock-in location');
    expect(res.text).toContain('Clock-in map link');
    expect(res.text).toContain('https://www.google.com/maps/search/?api=1&query=');
  });

  it('exports the muster roll as Excel', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const res = await api.get(`/api/v1/reports/muster-roll?month=${month}&format=xlsx`).set(auth(hr)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });
});
