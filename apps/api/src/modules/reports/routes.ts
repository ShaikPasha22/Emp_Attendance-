import { Router, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { ATTENDANCE_STATUSES, dateSchema, FLAG_LABELS, monthSchema, PERMISSIONS, STATUS_META, type AttendanceFlag, type AttendanceStatus } from '@app/shared';
import { z } from 'zod';
import { fullName } from '../../lib/employees';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { employeeScopeWhere } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { dateKeyToDb, dbDateToKey, diffDays, eachDate, localTimeOf, monthRange, weekdayOf } from '../../lib/time';
import { parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { placesOf } from '../attendance/service';

export const reportsRouter = Router();
reportsRouter.use(requirePermission(PERMISSIONS.REPORTS_VIEW));

const filters = z.object({
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  format: z.enum(['json', 'xlsx', 'csv']).default('json'),
});

/** Excel fill colours per status (ARGB). */
const FILL: Partial<Record<AttendanceStatus, string>> = {
  P: 'FFDCFCE7', L: 'FFFEF3C7', HD: 'FFFFEDD5', EO: 'FFFEF9C3', A: 'FFFEE2E2', LV: 'FFDBEAFE',
  WFH: 'FFCCFBF1', OD: 'FFE0E7FF', WO: 'FFF1F5F9', H: 'FFF3E8FF', MP: 'FFFFE4E6', FL: 'FFFAE8FF',
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function sendCsv(res: Response, filename: string, rows: unknown[][]) {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}

async function sendXlsx(res: Response, filename: string, wb: ExcelJS.Workbook) {
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

const scopedUsers = (req: Parameters<typeof employeeScopeWhere>[0], f: z.infer<typeof filters>): Prisma.UserWhereInput => ({
  AND: [employeeScopeWhere(req), f.departmentId ? { departmentId: f.departmentId } : {}, f.locationId ? { locationId: f.locationId } : {}],
});

reportsRouter.get('/muster-roll', async (req, res) => {
  const q = parse(filters.extend({ month: monthSchema }), req.query);
  const { from, to } = monthRange(q.month);
  const days = eachDate(from, to);
  const userWhere = scopedUsers(req.user!, q);

  const users = await prisma.user.findMany({
    where: {
      AND: [
        userWhere,
        { OR: [{ status: 'ACTIVE' }, { attendance: { some: { date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } } } }] },
      ],
    },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, designation: { select: { name: true } } },
    orderBy: { employeeCode: 'asc' },
  });
  const records = await prisma.attendanceRecord.findMany({
    where: { userId: { in: users.map((u) => u.id) }, date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } },
    select: { userId: true, date: true, status: true, workMinutes: true, flags: true },
  });
  const map = new Map(records.map((r) => [`${r.userId}|${dbDateToKey(r.date)}`, r]));

  const rows = users.map((u) => {
    const totals: Record<string, number> = { workMinutes: 0 };
    const cells = days.map((d) => {
      const r = map.get(`${u.id}|${d}`);
      if (r?.status) totals[r.status] = (totals[r.status] ?? 0) + 1;
      totals.workMinutes! += r?.workMinutes ?? 0;
      return (r?.status as AttendanceStatus | null) ?? null;
    });
    return {
      user: { id: u.id, employeeCode: u.employeeCode, name: fullName(u), department: u.department?.name ?? null, designation: u.designation?.name ?? null },
      cells,
      totals,
    };
  });

  if (q.format === 'json') {
    res.json({ month: q.month, days: days.map((d) => ({ date: d, weekday: weekdayOf(d) })), rows });
    return;
  }
  await audit(req, { action: 'report.exported', entityType: 'Report', summary: `Muster roll ${q.month} (${q.format})` });
  const totalCols = ATTENDANCE_STATUSES;
  const header = ['Code', 'Name', 'Department', ...days.map((d) => d.slice(8)), ...totalCols, 'Hours'];
  const body = rows.map((r) => [
    r.user.employeeCode,
    r.user.name,
    r.user.department ?? '',
    ...r.cells.map((c) => c ?? ''),
    ...totalCols.map((s) => r.totals[s] ?? 0),
    Math.round(((r.totals.workMinutes ?? 0) / 60) * 10) / 10,
  ]);
  const filename = `muster-roll-${q.month}.${q.format}`;
  if (q.format === 'csv') return sendCsv(res, filename, [header, ...body]);

  const { name } = await getCompanySettings();
  const wb = new ExcelJS.Workbook();
  wb.creator = name;
  const ws = wb.addWorksheet(`Muster ${q.month}`, { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
  ws.addRow([`${name} — Muster roll ${q.month}`]).font = { bold: true, size: 13 };
  const h = ws.addRow(header);
  h.font = { bold: true };
  h.alignment = { horizontal: 'center' };
  for (const row of body) {
    const added = ws.addRow(row);
    days.forEach((_, i) => {
      const cell = added.getCell(4 + i);
      const fill = FILL[cell.value as AttendanceStatus];
      cell.alignment = { horizontal: 'center' };
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  }
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 18;
  days.forEach((_, i) => (ws.getColumn(4 + i).width = 5));
  const legend = wb.addWorksheet('Legend');
  legend.addRow(['Code', 'Status', 'Meaning']).font = { bold: true };
  for (const s of ATTENDANCE_STATUSES) legend.addRow([s, STATUS_META[s].label, STATUS_META[s].description]);
  legend.getColumn(2).width = 18;
  legend.getColumn(3).width = 50;
  await sendXlsx(res, filename, wb);
});

reportsRouter.get('/attendance', async (req, res) => {
  const q = parse(filters.extend({ from: dateSchema, to: dateSchema }), req.query);
  if (diffDays(q.from, q.to) > 92) throw new AppError(422, 'RANGE_TOO_LONG', 'Choose a range of at most 3 months');
  const { timezone } = await getCompanySettings();
  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) }, user: scopedUsers(req.user!, q) },
    include: {
      user: { select: { employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, location: { select: { timezone: true, name: true } } } },
      punches: { orderBy: { at: 'asc' }, select: { type: true, latitude: true, longitude: true, address: true, distanceMeters: true } },
    },
    orderBy: [{ date: 'asc' }, { user: { employeeCode: 'asc' } }],
    take: 50_000,
  });
  const rows = records.map((r) => {
    const tz = r.user.location?.timezone ?? timezone;
    const { inPlace, outPlace } = placesOf(r.punches);
    return {
      date: dbDateToKey(r.date),
      employeeCode: r.user.employeeCode,
      name: fullName(r.user),
      department: r.user.department?.name ?? '',
      location: r.user.location?.name ?? '',
      clockIn: r.clockIn ? localTimeOf(r.clockIn, tz) : '',
      clockOut: r.clockOut ? localTimeOf(r.clockOut, tz) : '',
      hours: r.workMinutes ? Math.round((r.workMinutes / 60) * 100) / 100 : '',
      status: r.status ? STATUS_META[r.status as AttendanceStatus].label : '',
      lateMinutes: r.lateMinutes || '',
      flags: (r.flags as AttendanceFlag[]).map((f) => FLAG_LABELS[f] ?? f).join('; '),
      source: r.source,
      clockInLocation: inPlace ? (inPlace.address ?? 'Address pending') : '',
      clockInDistance: inPlace?.distanceMeters != null ? Math.round(inPlace.distanceMeters) : '',
      clockInMap: inPlace?.mapUrl ?? '',
      clockOutLocation: outPlace ? (outPlace.address ?? 'Address pending') : '',
      clockOutDistance: outPlace?.distanceMeters != null ? Math.round(outPlace.distanceMeters) : '',
      clockOutMap: outPlace?.mapUrl ?? '',
    };
  });
  if (q.format === 'json') return void res.json({ rows });
  await audit(req, { action: 'report.exported', entityType: 'Report', summary: `Attendance ${q.from} → ${q.to} (${q.format})` });
  const header = [
    'Date', 'Code', 'Name', 'Department', 'Office', 'Clock in', 'Clock out', 'Hours', 'Status', 'Late (min)', 'Flags', 'Source',
    'Clock-in location', 'Clock-in distance from office (m)', 'Clock-in map link',
    'Clock-out location', 'Clock-out distance from office (m)', 'Clock-out map link',
  ];
  const body = rows.map((r) => Object.values(r));
  const filename = `attendance-${q.from}-to-${q.to}.${q.format}`;
  if (q.format === 'csv') return sendCsv(res, filename, [header, ...body]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(header).font = { bold: true };
  body.forEach((r) => {
    const row = ws.addRow(r);
    // Make map links clickable in Excel.
    for (const col of [15, 18]) {
      const cell = row.getCell(col);
      if (typeof cell.value === 'string' && cell.value.startsWith('https://')) {
        cell.value = { text: 'Open map', hyperlink: cell.value };
        cell.font = { color: { argb: 'FF4F46E5' }, underline: true };
      }
    }
  });
  ws.columns.forEach((c) => (c.width = 14));
  ws.getColumn(3).width = 24;
  ws.getColumn(11).width = 32;
  ws.getColumn(13).width = 40;
  ws.getColumn(16).width = 40;
  await sendXlsx(res, filename, wb);
});
