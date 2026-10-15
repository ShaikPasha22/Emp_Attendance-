export const ATTENDANCE_STATUSES = ['P', 'L', 'HD', 'EO', 'A', 'LV', 'WFH', 'OD', 'WO', 'H', 'MP', 'FL'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Display metadata for every status. `tone` maps to a colour token in the UI. */
export const STATUS_META: Record<AttendanceStatus, { label: string; tone: string; description: string }> = {
  P: { label: 'Present', tone: 'green', description: 'Full day worked' },
  L: { label: 'Late', tone: 'amber', description: 'Present, clocked in after grace period' },
  HD: { label: 'Half Day', tone: 'orange', description: 'Worked less than the half-day threshold' },
  EO: { label: 'Early Out', tone: 'yellow', description: 'Left before shift end' },
  A: { label: 'Absent', tone: 'red', description: 'No valid attendance and no approved request' },
  LV: { label: 'On Leave', tone: 'blue', description: 'Approved leave' },
  WFH: { label: 'Work From Home', tone: 'teal', description: 'Approved work from home' },
  OD: { label: 'On Duty', tone: 'indigo', description: 'Approved on-duty (client visit, travel)' },
  WO: { label: 'Weekly Off', tone: 'slate', description: 'Weekly off as per policy' },
  H: { label: 'Holiday', tone: 'purple', description: 'Company holiday' },
  MP: { label: 'Missed Punch', tone: 'rose', description: 'Clock-out missing, needs regularization' },
  FL: { label: 'Flagged', tone: 'fuchsia', description: 'Under HR review' },
};

export const ATTENDANCE_FLAGS = {
  LATE: 'LATE',
  EARLY_OUT: 'EARLY_OUT',
  SHORT_HOURS: 'SHORT_HOURS',
  OUTSIDE_GEOFENCE_IN: 'OUTSIDE_GEOFENCE_IN',
  OUTSIDE_GEOFENCE_OUT: 'OUTSIDE_GEOFENCE_OUT',
  OUTSIDE_NETWORK_IN: 'OUTSIDE_NETWORK_IN',
  OUTSIDE_NETWORK_OUT: 'OUTSIDE_NETWORK_OUT',
  MISSED_PUNCH: 'MISSED_PUNCH',
  WORKED_ON_WEEKLY_OFF: 'WORKED_ON_WEEKLY_OFF',
  REMOTE_APPROVED: 'REMOTE_APPROVED',
  SUSPICIOUS_LOCATION: 'SUSPICIOUS_LOCATION',
} as const;
export type AttendanceFlag = (typeof ATTENDANCE_FLAGS)[keyof typeof ATTENDANCE_FLAGS];

/** Flags that put a record in the HR review queue. */
export const REVIEW_FLAGS: readonly AttendanceFlag[] = [
  ATTENDANCE_FLAGS.OUTSIDE_GEOFENCE_IN,
  ATTENDANCE_FLAGS.OUTSIDE_GEOFENCE_OUT,
  ATTENDANCE_FLAGS.OUTSIDE_NETWORK_IN,
  ATTENDANCE_FLAGS.OUTSIDE_NETWORK_OUT,
  ATTENDANCE_FLAGS.SUSPICIOUS_LOCATION,
];

export const FLAG_LABELS: Record<AttendanceFlag, string> = {
  LATE: 'Late arrival',
  EARLY_OUT: 'Left early',
  SHORT_HOURS: 'Short hours',
  OUTSIDE_GEOFENCE_IN: 'Clock-in outside office area',
  OUTSIDE_GEOFENCE_OUT: 'Clock-out outside office area',
  OUTSIDE_NETWORK_IN: 'Clock-in outside office network',
  OUTSIDE_NETWORK_OUT: 'Clock-out outside office network',
  MISSED_PUNCH: 'Missed clock-out',
  WORKED_ON_WEEKLY_OFF: 'Worked on weekly off',
  REMOTE_APPROVED: 'Remote (approved WFH / On-duty)',
  SUSPICIOUS_LOCATION: 'Location looks unreliable',
};

export const USER_STATUSES = ['INVITED', 'PENDING', 'ACTIVE', 'SUSPENDED', 'EXITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EMPLOYEE_TYPES = ['PERMANENT', 'CONTRACT', 'INTERN'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
};

export const REQUEST_TYPES = ['REGULARIZATION', 'WFH', 'ON_DUTY'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  REGULARIZATION: 'Attendance Correction',
  WFH: 'Work From Home',
  ON_DUTY: 'On Duty',
};

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const APPROVER_TYPES = ['REPORTING_MANAGER', 'HR'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  REPORTING_MANAGER: 'Reporting Manager',
  HR: 'HR',
};

export const PERMISSIONS = {
  EMPLOYEES_VIEW: 'employees.view',
  EMPLOYEES_MANAGE: 'employees.manage',
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_OVERRIDE: 'attendance.override',
  REQUESTS_APPROVE_HR: 'requests.approve_hr',
  SETTINGS_MANAGE: 'settings.manage',
  SECURITY_MANAGE: 'security.manage',
  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  PROFILES_MANAGE: 'profiles.manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'employees.view': 'View employees',
  'employees.manage': 'Manage employees & access',
  'attendance.view': 'View all attendance',
  'attendance.override': 'Override attendance / review flags',
  'requests.approve_hr': 'Approve requests (HR level)',
  'settings.manage': 'Manage org, shifts, policies, workflows',
  'security.manage': 'Manage login & attendance restrictions',
  'reports.view': 'View & export reports',
  'audit.view': 'View audit log',
  'profiles.manage': 'Manage permission profiles',
};

export const PROFILE_SCOPES = ['SELF', 'ASSIGNED', 'COMPANY'] as const;
export type ProfileScope = (typeof PROFILE_SCOPES)[number];

export const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
] as const;

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
