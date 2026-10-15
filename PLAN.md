# Attendance & HR Portal — Project Plan

> **Status:** Draft v2, awaiting final approval
> **Reference model:** Darwinbox (Time & Attendance, Leave, and Workflow modules)
> **Quality bar:** Production-grade, deployed on free tiers only
> **Last updated:** 2026-10-15

---

## Table of Contents
1. [Goal](#1-goal)
2. [What We Take from Darwinbox](#2-what-we-take-from-darwinbox)
3. [Organization Structure & Policy Applicability](#3-organization-structure--policy-applicability)
4. [Roles & Permissions](#4-roles--permissions)
5. [System Architecture](#5-system-architecture)
6. [Modules & Features](#6-modules--features)
7. [Attendance Policy Engine](#7-attendance-policy-engine)
8. [Core Processes](#8-core-processes)
9. [Attendance Status Codes](#9-attendance-status-codes)
10. [Data Model](#10-data-model)
11. [API Overview](#11-api-overview)
12. [Security & Compliance](#12-security--compliance)
13. [Build Roadmap](#13-build-roadmap)
14. [Configurable Restrictions & Decisions](#14-configurable-restrictions--decisions)
15. [Production Standards](#15-production-standards)
16. [Deployment on Free Tiers](#16-deployment-on-free-tiers)
17. [Development Setup & Conventions](#17-development-setup--conventions)

---

## 1. Goal

Build a system with two parts:

- **Employee App:** employees clock in and out with their geo-location, see their attendance, and raise requests.
- **HR Dashboard:** HR controls who gets access, decides which login and attendance restrictions apply, sets up policies, approves requests, and gets reports ready for payroll.

**Core principle (same as Darwinbox):** employees and managers only *submit* or *approve*. The **policy engine** works out the final attendance status. No one edits attendance directly without an approved request or a logged HR override.

**Default experience:** simple clock-in and clock-out with geo-location. Every stricter control (selfie, device binding, IP/Wi-Fi, time windows, 2FA) is **off by default** and can be **switched on by HR/Admin** from the dashboard. See [Section 14.1](#141-configurable-restrictions-hradmin-controlled).

---

## 2. What We Take from Darwinbox

| Darwinbox concept | How we implement it |
|---|---|
| **Multiple clock-in modes** (geo-fence, selfie, web, biometric) | **Default:** mobile/web clock-in with geo-location. **HR can switch on:** geo-fence blocking, selfie, device binding, IP/Wi-Fi restriction. Biometric sync is planned for later. |
| **Shifts & rosters** | Shift master (start, end, grace, break) assigned per employee or group. Rotational rosters come later. |
| **Attendance policy** (grace, late marks, half-day, penalties) | Configurable policy engine (see [Section 7](#7-attendance-policy-engine)) |
| **Attendance requests** (regularization, partial day, on-duty, WFH) | Request module, each type with its own workflow |
| **Leave policies** (types, accrual, carry forward, sandwich rule) | Leave module with balances and accrual job |
| **Configurable workflows** (multi-level approval, escalation, auto-action) | Workflow engine: levels, SLA escalation, auto-approve or auto-reject, delegation |
| **Policy applicability** (assign by location, department, grade, employee type) | Each policy has applicability rules. The most specific match wins. |
| **Security settings** (login policies, device and IP restrictions) | Restrictions center that HR controls, with company → policy → employee levels |
| **Attendance cycle & freeze** (e.g., 26th to 25th, locked before payroll) | Configurable attendance cycle and payroll lock |
| **Home dashboard with widgets** (clock-in, pending actions, holidays, who's on leave) | Widget-based home screen in both apps |
| **Employee / Manager / Admin views** | Role-based views and permission profiles |
| **Muster roll & analytics** | Reports module with Excel/CSV export |

Other products we looked at for comparison: Keka, greytHR, Zoho People, and Jibble. They follow the same submit → approve → compute pattern.

---

## 3. Organization Structure & Policy Applicability

Darwinbox's org hierarchy, which we copy:

```
Company
 └── Business Unit
      └── Department
           └── Designation
Location (office/site) ─── geo-fence (lat, lng, radius)
Employee Type: Permanent | Contract | Intern
Grade / Band:  e.g., G1–G8
```

**Policy applicability:** every policy (shift, attendance, restrictions, leave, holiday calendar, workflow) has applicability rules, for example:

| Policy | Applies to |
|---|---|
| "Bangalore General Shift 9:30–6:30" | Location = Bangalore |
| "Sales Field Attendance" (no geo-fence) | Department = Sales AND Employee Type = Permanent |
| "Intern Leave Policy" | Employee Type = Intern |

When several policies match, the **most specific** one wins. HR can also override the policy for a single employee.

---

## 4. Roles & Permissions

The system uses permission profiles, as Darwinbox does. A profile is a named set of permissions, so HR can create custom roles later.

| Role | Scope | Key permissions |
|---|---|---|
| **Employee** | Self | Clock in/out, view own attendance & leave, raise requests |
| **Reporting Manager** | Direct and indirect reports | Everything an employee can, plus team attendance, approve/reject team requests, team reports |
| **HR Business Partner (HRBP)** | Assigned business units or locations | Approve requests (second level), view and override attendance, employee setup |
| **HR Admin** | Whole company | Access management, **restriction settings**, all policy setup, payroll lock, all reports, audit log |
| **Super Admin** | System | Manage HR admins, permission profiles, system-wide security settings |

**Access lifecycle:** `Invited / Pending` → `Active` → `Suspended` → `Exited`. Only Active users can log in.

---

## 5. System Architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  ONE WEB APP (installable PWA) · React + Vite · [Cloudflare Pages]  │
 │  ┌────────────────────────────┐   ┌──────────────────────────────┐  │
 │  │ Employee experience  "/"   │   │ Dashboard  "/admin"          │  │
 │  │ mobile-first, bottom nav   │   │ Manager + HR, sidebar nav,   │  │
 │  │ clock-in, calendar, requests│  │ responsive (works on phone)  │  │
 │  └────────────────────────────┘   └──────────────────────────────┘  │
 │  One login · role decides what you see · dashboard code is loaded   │
 │  only for managers/HR, so the employee app stays small and fast     │
 └────────────────────────────────┬────────────────────────────────────┘
                                  │ same-origin /api/* (proxied) · JWT
                                  │
               ┌─────────────────▼──────────────────┐
               │   API SERVER (Node.js) [Render]    │
               │   Express + TypeScript             │
               │  ┌──────────────────────────────┐  │
               │  │ Auth & Permission Profiles   │  │
               │  │ Restrictions Center          │  │
               │  │ Org & Employee Management    │  │
               │  │ Attendance Policy Engine     │  │
               │  │ Leave Engine                 │  │
               │  │ Workflow Engine (approvals)  │  │
               │  │ Reports & Exports            │  │
               │  │ Notifications                │  │
               │  │ Job endpoints (secured)      │  │
               │  └──────────────────────────────┘  │
               └──────┬──────────────┬──────────────┘
                      │              │
          ┌───────────▼─────┐   ┌────▼───────────────┐   ┌──────────────────┐
          │ DATABASE        │   │ FILE STORAGE       │   │ GitHub Actions   │
          │ PostgreSQL      │   │ [Supabase Storage] │   │ CI/CD + scheduled│
          │ [Neon, pooled]  │   │ selfies (Phase 2)  │   │ jobs & backups   │
          │ prod + staging  │   └────────────────────┘   └──────────────────┘
          └─────────────────┘   Email API [Brevo / Resend]
          Monitoring: Sentry (errors) · UptimeRobot (uptime) · structured logs
```

### Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.9 (everywhere, strict mode) | One language, types shared across apps |
| Backend | Node.js 22 + Express 5 | Simple, widely used, async errors handled natively |
| Database | PostgreSQL (Neon) + Prisma 6 ORM | Relational data, type-safe queries, versioned migrations |
| File storage | Supabase Storage (Phase 2) | Selfies/documents, kept separate from app data |
| Validation | Zod 4 (in `packages/shared`) | Same rules on frontend and backend |
| Auth | JWT access token (15 min) + rotating refresh token in an httpOnly cookie | Secure, stateless |
| Frontend | React 19 + Vite 7 + Tailwind CSS 4, own lightweight component kit | Small bundle, fast load, no heavy UI library |
| Routing | React Router 7 with lazy-loaded routes | Each screen loads only when opened |
| Data fetching | TanStack Query 5 | Caching, instant back-navigation, background refresh |
| Offline shell | vite-plugin-pwa (Workbox) | App opens instantly on repeat visits, installable |
| Icons / fonts | lucide-react (tree-shaken) · system font stack | No font download, minimal icon weight |
| Charts | Recharts, lazy-loaded (Phase 2) | Only loaded on analytics pages |
| Maps | Leaflet + OpenStreetMap, lazy-loaded | Pick geo-fence locations (free, no API key) |
| Scheduled jobs | GitHub Actions cron → secured API job endpoints | Free. Render cron jobs are paid. |
| Exports | ExcelJS | Muster roll and payroll exports |
| Email | Brevo or Resend **HTTP API** | Render's free tier blocks outbound SMTP |
| Logging | pino (structured JSON, request IDs) | Searchable production logs |
| Errors | Sentry (free plan) | Error tracking with alerts |
| Testing | Vitest, Supertest, Playwright | Unit, API, and end-to-end tests |

### Repository Structure (Monorepo)

```
Attendance_App/
├── apps/
│   ├── api/            # Backend server
│   │   ├── prisma/     # Schema, migrations, seed data
│   │   └── src/
│   │       ├── modules/   # auth, org, employees, attendance, restrictions,
│   │       │              # leave, requests, workflow, reports, notifications
│   │       ├── engine/    # policy, restriction & status computation
│   │       ├── jobs/      # job handlers (triggered by GitHub Actions)
│   │       └── middleware/
│   └── web/            # One PWA: employee experience (/) + dashboard (/admin)
│       ├── functions/  # Cloudflare Pages Function: /api/* proxy to Render
│       └── src/
│           ├── components/  # Lightweight UI kit (buttons, sheets, tables…)
│           ├── employee/    # Mobile-first employee screens
│           └── admin/       # Manager + HR dashboard screens (lazy-loaded)
├── packages/
│   └── shared/         # Types, Zod schemas, constants (status codes etc.)
├── .github/workflows/  # CI, deploy, scheduled jobs, backups
├── docs/               # Runbook, architecture decisions, API docs
└── PLAN.md
```

**Rule:** the **server clock is the only source of truth.** Times sent from devices are never trusted.

### Speed & Ease-of-Use Principles
| Principle | How |
|---|---|
| **Fast first load** | Employee bundle kept small: no UI library, system fonts, dashboard and maps loaded only when needed |
| **Instant repeat loads** | PWA caches the app shell, so it opens like a native app |
| **No waiting on taps** | Cached data shown immediately, refreshed in the background. Buttons show progress at once. |
| **One login** | Employee and dashboard live in the same app, and managers/HR switch with one tap |
| **Mobile** | Bottom tab bar (Home · Attendance · Requests · Profile), large touch targets, bottom sheets for forms |
| **Desktop** | Top bar for employees. Sidebar for the dashboard. Tables turn into cards on small screens. |
| **Clear language** | Plain labels, colour + text for every status (never colour alone), helpful empty and error states |
| **Cold-start shield** | Uptime pinger keeps the API warm during working hours. The UI shows "Waking up server…" if it is ever slow. |

---

## 6. Modules & Features

### 6.1 Employee App

| Module | Features |
|---|---|
| **Home** | Clock-in/out widget with live timer, today's shift, pending requests, upcoming holidays, leave balance summary |
| **Clock In / Out** | One-tap clock-in/out that captures GPS location, inside or outside geo-fence indicator, server-time confirmation. Extra steps (selfie, etc.) appear only if HR has switched them on. |
| **My Attendance** | Monthly calendar color-coded by status, daily detail (in/out times, location, hours, flags), monthly summary |
| **Requests** | Regularization (missed or wrong punch), Partial Day, On-Duty, Work From Home, each with status tracking |
| **Leave** | Apply, cancel, view balances and history, holiday calendar |
| **Notifications** | Approvals, rejections, reminders |
| **Profile** | Personal details, reporting manager, shift, location, change password |

### 6.2 Manager View (inside the Dashboard)

| Module | Features |
|---|---|
| **Team Home** | Today's team status (In, Late, Absent, On Leave), pending approvals count |
| **Live Map** | Real-time map of the team's clock-in / clock-out locations: pins with names (green = working, grey = clocked out, red ring = outside office), country and state views, numbered groups when zoomed out, list of who is working / out / not in. Pins update within a second of each clock-in (Server-Sent Events). |
| **Approvals Inbox** | Approve or reject with a comment, bulk actions, request history |
| **Team Attendance** | Calendar and table view per team member, flagged entries |
| **Team Reports** | Late arrivals, hours worked, leave usage |

### 6.3 HR Dashboard

| Module | Features |
|---|---|
| **Live Dashboard** | Company-wide headcount present/late/absent/leave, filters by location and department, trend charts |
| **Access Management** | Invite employees (single or bulk CSV), approve pending sign-ups, assign role/profile, activate, suspend, or mark exited, reset devices, force logout |
| **Restrictions Center** | Turn login and attendance restrictions on or off at company, policy, or employee level (see [14.1](#141-configurable-restrictions-hradmin-controlled)) |
| **Employee Directory** | Profile, org placement (BU, department, designation, location, grade, type), reporting manager |
| **Attendance Records** | Search and filter all records, view punch location on a map, flagged entries queue (outside geo-fence, auto-closed punches), HR override with mandatory reason |
| **Approvals** | Second-level approvals, escalated requests, override any pending request |
| **Policy Setup** | Shifts, attendance policies, leave policies, holiday calendars, geo-fenced locations, each with applicability rules |
| **Workflow Setup** | Approval levels per request type, SLA escalation, auto-approve or auto-reject, delegation |
| **Attendance Cycle** | Define the cycle (e.g., 26th to 25th), review and **lock** before payroll |
| **Reports** | Muster roll, late-mark report, overtime, leave register, absenteeism, Excel/CSV export |
| **Audit Log** | Who changed what, when, before and after values |

---

## 7. Attendance Policy Engine

Each employee's effective attendance policy (resolved through the applicability rules) controls the following:

| Setting | Example | Effect |
|---|---|---|
| Shift timing | 09:30 – 18:30 | Expected work window |
| Grace period | 15 min | Check-in up to 09:45 counts as on time |
| Late mark | After grace | Day marked **Late** |
| Late mark penalty | 3 late marks/month = 0.5 day leave deducted | Applied by the monthly job |
| Early going | Check-out before 18:00 | Marked **Early Out** |
| Half-day threshold | Less than 4.5 hrs worked | **Half Day** |
| Absent threshold | Less than 2 hrs worked | **Absent** |
| Full-day minimum | 8 hrs | Full day |
| Weekly offs | Sat, Sun (or 2nd and 4th Sat) | Status **Weekly Off** |
| Overtime | After 9.5 hrs, needs approval | Overtime hours recorded (later phase) |
| Sandwich rule | Leave on Fri and Mon counts the weekend too | Applied in the leave engine |

Clock-in restrictions (geo-fence mode, selfie, time window, device, IP) are configured separately in the **Restrictions Center** (see [14.1](#141-configurable-restrictions-hradmin-controlled)).

**How the engine works:** each day's status is computed from the punches, the shift, any approved requests, leave, holidays and weekly offs. It is **recomputed** automatically whenever any of these change (e.g., a regularization is approved).

---

## 8. Core Processes

### Process A: Employee Onboarding & Access
```
HR invites employee ──► Account "Invited" ──► Employee sets password via email link
        or                                              │
Employee self-signs-up ──► "Pending" ──► HR approves ───┤   (sign-up mode is set by HR)
                                                        ▼
                          HR assigns: BU, department, designation, location,
                          grade, type, reporting manager, permission profile
                                                        ▼
                Policies & restrictions auto-assigned by applicability rules
                                                        ▼
                                              Account "Active"
```

### Process B: Daily Clock-In / Clock-Out (default flow)
```
Employee taps "Clock In"
   ▼
App asks for location permission (first time) ──► captures GPS + accuracy ──► sends to server
   ▼
Server validates:
   ✓ account active                ✓ not already clocked in
   ✓ GPS accuracy acceptable       ✓ inside geo-fence? (outside → flagged by default)
   ✓ + any extra restrictions HR has switched on (selfie, device, IP, time window)
   ▼
Record saved with SERVER time + location ──► status: On Time / Late (+ Flagged if outside)
   ▼
Employee taps "Clock Out" ──► location captured ──► hours computed ──► Present / Half Day / Early Out
   ▼
Back at work (client visit, break)? "Clock in again" reopens the day — first in, last out (Darwinbox default)
```

**Every punch is logged** (`AttendancePunch`): time, GPS coordinates, accuracy, distance from the office, IP, device and flags. Employees see their day's activity. HR sees it on a map next to the office geo-fence when reviewing.

**How geo-location is verified:**

| Layer | Check |
|---|---|
| Device | High-accuracy GPS, a fresh fix taken at the moment of the tap (no cached positions). The app waits up to 8 s for a precise reading. |
| Server | Server clock only. Rejects readings older than 2 min and readings less precise than the HR limit (default ±150 m). |
| Geo-fence | Haversine distance to the employee's assigned office, compared with the office radius. Off / Allow & flag / Block, per HR policy. |
| Anti-spoofing | Readings with zero accuracy, impossible travel since the last punch (> 250 km/h), and coordinates frozen bit-for-bit for hours are flagged "Location looks unreliable" and sent to HR review. |
| Optional layers | Office network (IP / Wi-Fi), device binding, clock-in window (selfie in Phase 2). HR switches these on per company, group or employee. |

### Process C: Automated Jobs
These are triggered by GitHub Actions on a schedule and call secured API endpoints. Every job is **idempotent**, so running it twice is safe.

| Job | When (IST) | What it does |
|---|---|---|
| Missed clock-out closer | Hourly | Auto-closes open punches 4 hrs after shift end and flags them for regularization |
| Daily status computation | Nightly 00:30 | Marks Absent, Weekly Off, Holiday, Leave for every employee |
| Reminders | Morning / evening | "You haven't clocked in" / "Don't forget to clock out" |
| Workflow escalation | Hourly | Escalates or auto-actions requests past their SLA |
| Late-mark penalty | Cycle end | Applies late-mark deductions |
| Leave accrual | Monthly | Credits leave balances per policy |
| Location names | Hourly | Fills in any clock-in/out place names still missing, e.g. after a restart |
| Database backup | Nightly | `pg_dump`, encrypted, kept for 30 days |

### Process D: Requests & Approval Workflow
```
Employee raises request (Regularization / Partial Day / On-Duty / WFH / Leave)
   ▼
Level 1: Reporting Manager ── reject (comment required) ──► Employee notified
   │ approve
   ▼
Level 2: HRBP / HR (configurable per request type) ── reject ──► Employee notified
   │ approve
   ▼
Attendance recomputed / leave balance updated ──► Employee notified ──► Audit logged
```
**Workflow rules (Darwinbox-style):**
- **SLA escalation:** if an approver doesn't act in N days, the request moves to the next level or to HR.
- **Auto-action:** auto-approve or auto-reject after a deadline (configurable).
- **Delegation:** an approver on leave can delegate approvals to someone else.
- **Limits:** regularization allowed only within X days, max Y requests per month.
- **Locked cycle:** no requests allowed for a locked attendance period.

### Process E: Month-End / Payroll
```
Cycle ends (e.g., 25th) ──► HR reviews flagged entries & pending requests
   ▼
Reminder to managers to clear pending approvals
   ▼
Late-mark penalties applied ──► HR LOCKS the cycle
   ▼
Muster roll exported (Excel/CSV) ──► Payroll
```

---

## 9. Attendance Status Codes

| Code | Status | Meaning |
|---|---|---|
| `P` | Present | Full day worked |
| `L` | Late | Present, checked in after grace |
| `HD` | Half Day | Worked less than the full-day threshold |
| `EO` | Early Out | Left before shift end |
| `A` | Absent | No valid attendance, no leave |
| `LV` | On Leave | Approved leave (with leave type) |
| `WFH` | Work From Home | Approved WFH |
| `OD` | On Duty | Approved on-duty (client visit, travel) |
| `WO` | Weekly Off | As per weekly-off policy |
| `H` | Holiday | As per holiday calendar |
| `MP` | Missed Punch | Clock-out missing, needs regularization |
| `FL` | Flagged | Outside geo-fence or anomaly, under HR review |

---

## 10. Data Model

| Entity | Key fields |
|---|---|
| `Company`, `BusinessUnit`, `Department`, `Designation`, `Grade` | Org structure |
| `Location` | name, address, lat, lng, radius_m, timezone, allowed_ips[] |
| `User` | employee_code, name, email, phone, password_hash, status, employee_type, org links, manager_id, profile_id |
| `PermissionProfile` | name, permissions[] |
| `RestrictionPolicy` | all restriction toggles (see 14.1), applicability rules, priority |
| `UserRestrictionOverride` | user_id, overridden settings, reason, set_by |
| `CompanySecuritySettings` | sign-up mode, allowed domains, password policy, lockout, session timeouts, admin 2FA |
| `Device` | user_id, device_fingerprint, approved, last_used |
| `Session` | user_id, refresh_token_hash, device, ip, expires_at, revoked |
| `LoginAttempt` | email, ip, success, timestamp (used for lockout) |
| `Shift` | name, start, end, grace_min, break_min |
| `AttendancePolicy` | thresholds, weekly offs, penalty rules |
| `PolicyAssignment` | policy_type, policy_id, applicability rules, priority |
| `AttendanceRecord` | user_id, date, clock_in, clock_out, in/out lat/lng/accuracy, in_geofence, ip, hours, status, flags[], source |
| `Request` | type, user_id, date range, reason, payload, status, current_level |
| `WorkflowDefinition` | request_type, levels[], SLA, auto-action rules |
| `Approval` | request_id, level, approver_id, decision, comment, acted_at |
| `LeaveType`, `LeavePolicy`, `LeaveBalance` | Types, accrual and carry-forward rules, balances |
| `HolidayCalendar`, `Holiday` | Calendars assigned by location |
| `AttendanceCycle` | start, end, locked, locked_by |
| `Notification` | user_id, type, message, read |
| `AuditLog` | actor_id, action, entity, before, after, timestamp, ip, request_id |

Indexes on `(user_id, date)` for attendance, `(status, current_level)` for requests, and `(entity, timestamp)` for audit. A unique constraint on `(user_id, date)` stops duplicate attendance rows.

---

## 11. API Overview

All endpoints are versioned under `/api/v1`. OpenAPI (Swagger) docs are generated from the Zod schemas.

| Area | Main endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/accept-invite`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password` |
| Attendance | `POST /attendance/clock-in`, `POST /attendance/clock-out`, `GET /attendance/me?month=`, `GET /attendance/today` |
| Requests | `POST /requests`, `GET /requests/me`, `GET /requests/inbox`, `POST /requests/:id/approve`, `POST /requests/:id/reject` |
| Leave | `GET /leave/balances`, `POST /leave/apply`, `GET /holidays` |
| Team (Manager) | `GET /team/today`, `GET /team/attendance` |
| HR — Access | `GET/POST /admin/employees`, `POST /admin/employees/invite`, `POST /admin/employees/:id/approve`, `PATCH /admin/employees/:id/status`, `POST /admin/employees/:id/reset-device`, `POST /admin/employees/:id/force-logout` |
| HR — Restrictions | `GET/PUT /admin/security-settings`, CRUD `/admin/restriction-policies`, `PUT /admin/employees/:id/restriction-override` |
| HR — Setup | CRUD `/admin/locations`, `/admin/shifts`, `/admin/policies`, `/admin/workflows`, `/admin/holidays`, `/admin/org/*` |
| HR — Attendance | `GET /admin/attendance`, `PATCH /admin/attendance/:id` (override with reason), `POST /admin/cycles/:id/lock` |
| Reports | `GET /reports/muster-roll`, `/reports/late-marks`, `/reports/leave`, `?format=xlsx\|csv` |
| Audit | `GET /admin/audit-logs` |
| System | `GET /healthz` (no DB, liveness), `GET /readyz` (DB check), `POST /internal/jobs/:name` (secret-protected) |

---

## 12. Security & Compliance

- **Passwords:** argon2id hashing, policy set by HR, reset by single-use email link.
- **Sessions:** 15-minute access tokens, rotating refresh tokens (hashed in DB, reuse detection), httpOnly + Secure + SameSite cookies, CSRF protection.
- **Account lockout:** after repeated failed logins (always on, threshold adjustable).
- **Authorization:** every endpoint checks the permission profile and data scope (self / team / BU / company).
- **Hardening:** Helmet security headers, strict CORS allowlist, rate limiting on auth and clock-in, request size limits.
- **Server-side validation** of time, geo-fence, and all inputs.
- **Audit trail** for every HR/admin change, every restriction change, and every approval.
- **Privacy (India DPDP Act 2023):** location captured **only at clock-in/out** (no background tracking), consent notice shown in the app, location data kept for a set period (e.g., 12 months), then purged.
- **GPS spoofing:** a PWA cannot detect mock-location apps. HR can raise assurance by switching on IP/Wi-Fi restriction, device binding, or selfie (later). A native app is the stronger option if needed.
- **Dependencies:** Dependabot and `npm audit` in CI. Secrets live only in platform environment variables.

---

## 13. Build Roadmap

### Phase 1: MVP (build first)
- [ ] Monorepo, TypeScript, lint/format, CI pipeline (lint → typecheck → test → build)
- [ ] Database schema, migrations, seed data (demo HR, manager, employee)
- [ ] Auth, sessions, permission profiles, access lifecycle (invite / sign-up / approve / suspend)
- [ ] Org setup: BU, department, designation, location (geo-fence on map), grade
- [ ] Shifts and attendance policy with applicability rules
- [ ] **Restrictions Center:** company/policy/employee levels with geo-fence mode, GPS accuracy, time window, device binding, IP/Wi-Fi restriction, sign-up mode, allowed domains, password policy, lockout, session timeouts
- [ ] Employee app: home, **clock-in/out with geo-location**, my attendance calendar
- [ ] Requests: regularization, WFH, on-duty with a 2-level workflow
- [ ] Policy engine: daily status computation and recompute on approval
- [ ] Scheduled jobs via GitHub Actions: missed clock-out closer, absent marking, backups
- [ ] HR dashboard: live board, access management, attendance records with map, approvals inbox
- [ ] Manager view: team today, approvals
- [ ] Muster roll export (Excel/CSV), audit log
- [ ] Production deployment (Render + static host + Neon), Sentry, uptime monitoring, runbook

### Phase 2
- [ ] Leave module: types, policies, balances, accrual, sandwich rule
- [ ] Holiday calendars by location
- [ ] Workflow SLA escalation, auto-action, delegation
- [ ] Late-mark penalties, attendance cycle and payroll lock
- [ ] Email notifications and reminders
- [ ] **Selfie on clock-in** (HR toggle) stored in Supabase Storage
- [ ] **2FA (authenticator app)** for HR/Admin, plus concurrent-session limits
- [ ] Analytics charts and full reports suite

### Phase 3
- [ ] Google Workspace / Microsoft SSO
- [ ] Rotational rosters and shift swap requests
- [ ] Overtime and comp-off
- [ ] Native mobile app (React Native / Expo), face recognition
- [ ] Biometric device integration

---

## 14. Configurable Restrictions & Decisions

### 14.1 Configurable Restrictions (HR/Admin controlled)

HR/Admin manage every login and attendance restriction from **Dashboard → Settings → Restrictions Center**. Nothing is hard-coded.

**Three levels (the most specific wins):**
```
Company default  ──►  Restriction Policy (by location / department / grade / type)  ──►  Individual employee override
```
Every change records who made it, when, the old and new values, and a reason.

#### A. Attendance (clock-in/out) restrictions

| Restriction | What it does | Options | **Default** | Phase |
|---|---|---|---|---|
| Geo-location capture | Records GPS at clock-in and clock-out | On / Off | **On** | 1 |
| Geo-fence mode | What happens outside the office radius | Off / Allow & flag / Block | **Allow & flag** | 1 |
| GPS accuracy limit | Rejects very imprecise locations | 50 – 500 m | **150 m** | 1 |
| Remote clock-in | Skip the geo-fence on approved WFH / On-Duty days | On / Off | **On** | 1 |
| Clock-in time window | Only allow clock-in between set hours | Off / custom window | **Off** | 1 |
| Device binding | Only allow clock-in from registered device(s) | Off / 1 device / N devices | **Off** | 1 |
| IP / office Wi-Fi restriction | Only allow clock-in from listed office networks | Off / Allow & flag / Block | **Off** | 1 |
| Selfie on clock-in | Capture a photo with each punch | On / Off | **Off** | 2 |

#### B. Login & account restrictions

| Restriction | What it does | Options | **Default** | Phase |
|---|---|---|---|---|
| Sign-up mode | How employees get accounts | Invite-only / Self sign-up + HR approval | **Both allowed** | 1 |
| Allowed email domains | Only these domains can sign up or be invited | List of domains | **Off** | 1 |
| Password policy | Minimum length, complexity, expiry | Configurable | **Min 8 chars, letters + numbers** | 1 |
| Account lockout | Lock after failed attempts | Attempts and lock duration | **5 attempts → 15 min** (always on) | 1 |
| Session timeout | Auto-logout after inactivity | Separate for dashboard and app | **Dashboard 30 min · App 30 days** | 1 |
| Dashboard IP allowlist | HR/Admin dashboard only reachable from listed IPs | Off / IP list | **Off** | 1 |
| Force logout / reset device | Admin action per employee | Action | Available | 1 |
| 2FA for HR/Admin | Authenticator app code at login | Off / Optional / Required | **Off** | 2 |
| Concurrent sessions | Limit active logins per user | Unlimited / N | **Unlimited** | 2 |

### 14.2 Decisions

| # | Question | Options | Decision |
|---|---|---|---|
| 1 | Employee app type | PWA / Native app | ✅ **Decided: one PWA** with the employee experience and the `/admin` dashboard |
| 2 | Default clock-in verification | Geo-location / + selfie / etc. | ✅ **Decided: simple clock-in/out with geo-location.** Everything else is an HR toggle. |
| 3 | Outside geo-fence behaviour | Block / Allow and flag | **Allow & flag** (HR can change per policy) |
| 4 | Approval chain | Manager → HR / HR only | **Manager → HR** (configurable per request type) |
| 5 | Leave module timing | MVP / Phase 2 | **Phase 2** |
| 6 | Hosting | Free tiers only | ✅ **Decided: free tiers.** Stack in [Section 16](#16-deployment-on-free-tiers). |
| 7 | Frontend host | Vercel / Cloudflare Pages / Render Static | **Cloudflare Pages recommended.** Vercel Hobby is non-commercial only (see 16.3). |
| 7a | Databases | One / two | ✅ **Decided: Neon for all app data (prod + staging), Supabase for file storage only** |
| 8 | Domain | Company subdomains / free platform URLs | **Company subdomains recommended** (e.g., `attendance.company.com`, `api.company.com`) |
| 9 | Product name and branding | Custom name, logo, colors | **Placeholder** until provided |

---

## 15. Production Standards

What "production standard" means for this project. Each item is a requirement, not a nice-to-have.

| Area | Standard |
|---|---|
| **Code quality** | TypeScript strict, ESLint + Prettier, no `any` in domain code, pre-commit hooks (lint-staged), Conventional Commits |
| **Architecture** | Modular backend (routes → controllers → services → repositories), shared Zod schemas, centralized error handling with a consistent error format |
| **Testing** | Unit tests for the policy and restriction engines (≥ 90% coverage). API integration tests against a real Postgres. Playwright end-to-end tests for login, clock-in/out, request → approval. |
| **CI/CD** | GitHub Actions on every PR: lint, typecheck, test, build. Merge to `main` deploys automatically. Migrations run with `prisma migrate deploy` during release. |
| **Environments** | `development` (local), `staging`, `production`, with separate databases (Neon branches) and secrets |
| **API design** | Versioned (`/api/v1`), OpenAPI docs, pagination on lists, idempotent clock-in (no double punches), request IDs on every response |
| **Security** | Section 12 in full. OWASP Top 10 checklist reviewed before launch. |
| **Observability** | Structured JSON logs with request IDs, Sentry error tracking with alerts, `/healthz` and `/readyz` endpoints, uptime monitoring with email alerts |
| **Data safety** | Versioned migrations only (no manual DB edits), nightly encrypted backups (30-day retention), restore tested before launch, soft-delete for employees, UTC storage |
| **Performance** | API p95 < 300 ms when warm. Pooled DB connections. Code-split frontends. Lighthouse PWA/Performance ≥ 90. |
| **Accessibility & UX** | WCAG 2.1 AA, fully responsive, clear loading/empty/error states, works on low-end Android phones |
| **Documentation** | README, `.env.example`, deployment runbook, architecture decision records, admin user guide |
| **Releases** | Semantic versioning, CHANGELOG, verify on staging before production |

---

## 16. Deployment on Free Tiers

> Free-tier limits checked in October 2026. Re-check them before launch, because providers change them.

### 16.1 Recommended Stack

| Component | Platform (free tier) | Notes |
|---|---|---|
| **Database** | **Neon** (serverless PostgreSQL) | All app data. Production + staging branches. See 16.2. |
| **File storage** | **Supabase Storage** (Phase 2) | Selfies/documents only. A daily keep-alive ping prevents the 7-day pause. |
| **API server** | **Render** free web service (Singapore region) | Sleeps after 15 min idle, see 16.4 |
| **Web app (employee + dashboard)** | **Cloudflare Pages** (recommended) or Render Static Sites | Global CDN, free SSL, custom domains, `/api` proxy function |
| **Scheduled jobs & backups** | **GitHub Actions** (scheduled workflows) | Render cron jobs are paid |
| **Email** | **Brevo** or **Resend** (HTTP API) | Render free blocks SMTP ports, so we use the HTTP API |
| **Error tracking** | **Sentry** free plan | Errors and alerts |
| **Uptime monitoring** | **UptimeRobot** free plan | Also keeps the API warm during work hours |

### 16.2 Database Choice: Neon for data + Supabase for files

**Why two services:** each one is used for what it does best on the free tier.
- **Neon** holds **all** relational app data (employees, attendance, requests, audit). It never pauses, and its free branches give us a staging database.
- **Supabase** holds **files only** (selfies in Phase 2). Its free 1 GB storage keeps large files out of Neon's 0.5 GB.
- We never split app tables across both. That would break transactions and reports.

| Option | Free tier | Verdict |
|---|---|---|
| **Neon** | Permanent free plan, 0.5 GB storage, 100 compute-hours/month, scales to zero when idle, branches (for staging), 6-hour restore window | ✅ **Best fit.** Real PostgreSQL, works natively with Prisma, never expires. Branches give us a free staging database. |
| Supabase | 500 MB database, projects **pause after 1 week of inactivity**, 2 projects per org | ⚠️ Good alternative, but the inactivity pause is a production risk (e.g., over long holidays). |
| Render PostgreSQL | **Expires 30 days after creation**, then deleted | ❌ Not suitable for production |
| MongoDB Atlas (M0) | 512 MB | ❌ Our data is relational (approvals, policies, org tree), so PostgreSQL fits better |

**Is 0.5 GB enough?** One attendance record is roughly 0.5 KB with indexes. 500 employees × 260 working days ≈ 130,000 rows/year ≈ **65 MB/year**. With requests and audit logs (purged after the retention period), 0.5 GB covers several years for a few hundred employees.

**Saving compute-hours:** the `/healthz` endpoint used by the uptime pinger **does not touch the database**, so Neon can scale to zero between real requests.

### 16.3 Why Not Vercel for Production

Vercel's **Hobby (free) plan is for non-commercial personal use only**. Its terms say any project built by a paid employee, or for financial gain, needs a paid plan. A company attendance app falls under that. Vercel is fine for personal demos. For production on free tiers, **Cloudflare Pages** or **Render Static Sites** avoid this risk.

### 16.4 Handling Render Free-Tier Limits

| Limit | Impact | Mitigation |
|---|---|---|
| Sleeps after 15 min idle, ~1 min to wake | First clock-in of the morning could be slow | UptimeRobot pings `/healthz` every 10 min **during working hours only (e.g., 07:00–21:00 IST)** |
| 750 free instance-hours/month per workspace | Running all month non-stop uses ~720 hrs | Pinging only during work hours ≈ 430 hrs/month. Staging stays asleep when unused. |
| No outbound SMTP | Can't send email over SMTP | Brevo/Resend HTTP API |
| Ephemeral filesystem | Local files are lost on restart | Nothing is stored on disk; files go to object storage (Phase 2) |
| No free cron jobs | — | GitHub Actions scheduled workflows call `/internal/jobs/*` with a secret |

### 16.5 Cookies Across Domains

The frontend and API live on different hosts. Browsers increasingly block cookies between different sites, which would break login refresh.

- **Recommended:** use company subdomains (`attendance.company.com`, `hr.company.com`, `api.company.com`). The cookies then count as same-site.
- **Fallback (no custom domain):** route `/api/*` through the frontend host (Cloudflare Pages Function proxy), so the browser sees one origin.

### 16.6 When to Upgrade

The free tier fits a **pilot and small-to-mid teams**. Upgrade signals are cold starts hurting users, Neon storage above 400 MB, or need for SLA support. The cheapest first step is a Render paid instance (no sleep), roughly $7/month.

---

## 17. Development Setup & Conventions

**Prerequisites:** Node.js 22+, npm 11+. No Docker needed: `npm run db:local` starts an embedded PostgreSQL. Docker Compose or a Neon `dev` branch also work.

```bash
npm install                 # install all workspaces
cp .env.example .env        # defaults work with the embedded local database
npm run db:local            # start local PostgreSQL (keep this terminal open)
npm run db:migrate          # apply schema
npm run db:seed             # demo data + demo accounts
npm run dev                 # api :4000, web :5173 (/ = employee, /admin = dashboard)
npm test                    # unit + integration tests
```

**Conventions:**
- TypeScript strict mode, ESLint and Prettier, Conventional Commits.
- Shared types and validation live in `packages/shared`. Never duplicate them.
- All dates are stored in UTC and shown in the location's timezone (default `Asia/Kolkata`).
- Every state change to attendance, requests, or restrictions writes an `AuditLog` entry.
- Policy and restriction engine logic must have unit tests.
- Env config lives in `.env` (with `.env.example` committed). Secrets are never committed.
- Branching: `main` (production), `develop` (staging), feature branches through pull requests.
pause h