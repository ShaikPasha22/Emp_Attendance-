import type {
  ApproverType,
  AttendanceFlag,
  AttendanceStatus,
  EmployeeType,
  Permission,
  ProfileScope,
  RequestStatus,
  RequestType,
  UserStatus,
} from './constants';
import type { AttendanceRestrictions } from './schemas/restrictions';

/** Standard error body returned by the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Ref {
  id: string;
  name: string;
}

export interface SessionUser {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  status: UserStatus;
  permissions: Permission[];
  scope: ProfileScope;
  profileName: string;
  hasReports: boolean;
  canAccessDashboard: boolean;
  dashboardIdleMinutes: number;
}

export interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}

export interface ShiftInfo {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
}

export interface TodayAttendance {
  date: string;
  timezone: string;
  serverTime: string;
  shift: ShiftInfo | null;
  isWeeklyOff: boolean;
  approvedRemote: RequestType | null;
  record: AttendanceDay | null;
  punches: AttendancePunchDto[];
  restrictions: Pick<AttendanceRestrictions, 'geoCapture' | 'geofenceMode' | 'maxAccuracyMeters' | 'selfieRequired'>;
  office: OfficeInfo | null;
}

export interface AttendancePunchDto {
  id: string;
  type: 'IN' | 'OUT';
  at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  distanceMeters: number | null;
  flags: AttendanceFlag[];
  /** Readable place: office name inside the geo-fence, else the looked-up address (null until resolved) */
  address: string | null;
  /** Google Maps link to the exact spot */
  mapUrl: string | null;
}

/** Where a clock-in / clock-out happened, for list views. */
export interface PunchPlace {
  address: string | null;
  mapUrl: string | null;
  distanceMeters: number | null;
}

export interface OfficeInfo {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
}

/** One day with its full punch log (employee day view and HR record detail). */
export interface AttendanceDayDetail {
  date: string;
  timezone: string;
  office: OfficeInfo | null;
  record: AttendanceDay | null;
  punches: AttendancePunchDto[];
}

export interface AttendanceDay {
  id: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  workMinutes: number | null;
  status: AttendanceStatus | null;
  flags: AttendanceFlag[];
  lateMinutes: number;
  source: string;
  reviewStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  inDistanceMeters: number | null;
  outDistanceMeters: number | null;
  /** First clock-in / last clock-out place (present in HR, team and day views) */
  inPlace?: PunchPlace | null;
  outPlace?: PunchPlace | null;
  inLat?: number | null;
  inLng?: number | null;
  outLat?: number | null;
  outLng?: number | null;
}

export interface MonthAttendance {
  month: string;
  timezone: string;
  days: AttendanceDay[];
  summary: Partial<Record<AttendanceStatus, number>> & { workMinutes: number };
  weeklyOffs: number[];
}

export interface PunchResult {
  record: AttendanceDay;
  message: string;
  warnings: string[];
}

export interface RequestDto {
  id: string;
  type: RequestType;
  status: RequestStatus;
  startDate: string;
  endDate: string;
  reason: string;
  payload: Record<string, unknown>;
  currentLevel: number;
  levels: { approverType: ApproverType }[];
  createdAt: string;
  decidedAt: string | null;
  user: { id: string; name: string; employeeCode: string; department: string | null };
  approvals: {
    level: number;
    decision: 'APPROVED' | 'REJECTED';
    comment: string | null;
    approver: string;
    createdAt: string;
  }[];
}

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  status: UserStatus;
  employeeType: EmployeeType;
  department: string | null;
  designation: string | null;
  location: string | null;
  manager: string | null;
  profile: string;
  lastLoginAt: string | null;
}

export interface LiveDashboard {
  date: string;
  totals: {
    active: number;
    clockedIn: number;
    late: number;
    notIn: number;
    remote: number;
    weeklyOff: number;
    flagged: number;
    pendingApprovals: number;
    pendingAccess: number;
  };
  byDepartment: { department: string; total: number; present: number; late: number }[];
  recentPunches: {
    userId: string;
    name: string;
    department: string | null;
    clockIn: string | null;
    clockOut: string | null;
    status: AttendanceStatus | null;
    flags: AttendanceFlag[];
  }[];
}

export type LiveStatus = 'WORKING' | 'CLOCKED_OUT' | 'NOT_IN';

export interface LiveMapEmployee {
  id: string;
  name: string;
  employeeCode: string;
  department: string | null;
  designation: string | null;
  office: string | null;
  liveStatus: LiveStatus;
  attendanceStatus: AttendanceStatus | null;
  firstIn: string | null;
  lastOut: string | null;
  workMinutes: number | null;
  /** Latest punch that has a location — where the pin is drawn */
  lastPunch: {
    type: 'IN' | 'OUT';
    at: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    address: string | null;
    state: string | null;
    country: string | null;
    distanceMeters: number | null;
    mapUrl: string;
    outsideOffice: boolean;
    flags: AttendanceFlag[];
  } | null;
}

export interface LiveMapResponse {
  date: string;
  timezone: string;
  generatedAt: string;
  isToday: boolean;
  offices: { id: string; name: string; latitude: number; longitude: number; radiusMeters: number }[];
  employees: LiveMapEmployee[];
  summary: { total: number; working: number; clockedOut: number; notIn: number; outsideOffice: number };
}
