import { PERMISSIONS, type Paginated, type EmployeeListItem, type RequestDto } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  CheckSquare,
  Clock,
  FileBarChart,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MapPin,
  MapPinned,
  Menu,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar } from '../components/ui/Display';
import { useToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ConnectionBanner, Logo, NotificationBell } from './common';
import { QuickClock } from './QuickClock';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
  count?: number;
  end?: boolean;
}

/** Signs the user out after the HR-configured idle time on the dashboard. */
function useIdleLogout(minutes: number) {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        await logout();
        toast.info('Signed out for inactivity', `You were idle on the dashboard for ${minutes} minutes.`);
        navigate('/login');
      }, minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, logout, navigate, toast]);
}

export default function AdminLayout() {
  const { user, can, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useIdleLogout(user?.dashboardIdleMinutes ?? 30);
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const isApprover = !!user?.hasReports || can(PERMISSIONS.REQUESTS_APPROVE_HR);
  const canSeeEmployees = can(PERMISSIONS.EMPLOYEES_VIEW) || can(PERMISSIONS.EMPLOYEES_MANAGE);
  const inbox = useQuery({
    queryKey: ['requests', 'inbox'],
    queryFn: () => api.get<RequestDto[]>('/requests/inbox'),
    enabled: isApprover,
    refetchInterval: 60_000,
  });
  const pendingAccess = useQuery({
    queryKey: ['employees', 'pending-count'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/admin/employees?status=PENDING&pageSize=1'),
    enabled: canSeeEmployees,
    refetchInterval: 120_000,
  });

  const settings = can(PERMISSIONS.SETTINGS_MANAGE);
  const security = can(PERMISSIONS.SECURITY_MANAGE);
  const groups: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, show: can(PERMISSIONS.ATTENDANCE_VIEW), end: true },
        { to: '/admin/approvals', label: 'Approvals', icon: CheckSquare, show: isApprover, count: inbox.data?.length },
        { to: '/admin/team', label: 'My Team', icon: UsersRound, show: !!user?.hasReports },
        { to: '/admin/map', label: 'Live Map', icon: MapPinned, show: !!user?.hasReports || can(PERMISSIONS.ATTENDANCE_VIEW) },
        { to: '/admin/attendance', label: 'Attendance', icon: CalendarCheck, show: can(PERMISSIONS.ATTENDANCE_VIEW) },
        { to: '/admin/employees', label: 'Employees & Access', icon: Users, show: canSeeEmployees, count: pendingAccess.data?.total },
        { to: '/admin/reports', label: 'Reports', icon: FileBarChart, show: can(PERMISSIONS.REPORTS_VIEW) },
      ],
    },
    {
      title: 'Settings',
      items: [
        { to: '/admin/settings/organization', label: 'Organization', icon: Building2, show: settings },
        { to: '/admin/settings/locations', label: 'Locations', icon: MapPin, show: settings },
        { to: '/admin/settings/shifts', label: 'Shifts', icon: Clock, show: settings },
        { to: '/admin/settings/policies', label: 'Attendance Policies', icon: SlidersHorizontal, show: settings },
        { to: '/admin/settings/restrictions', label: 'Restrictions Center', icon: ShieldCheck, show: security },
        { to: '/admin/settings/workflows', label: 'Approval Workflows', icon: GitBranch, show: settings },
        { to: '/admin/audit', label: 'Audit Log', icon: ScrollText, show: can(PERMISSIONS.AUDIT_VIEW) },
      ],
    },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4" aria-label="Dashboard">
      {groups.map((g, i) => {
        const items = g.items.filter((it) => it.show);
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.title && <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{g.title}</p>}
            <ul className="space-y-0.5">
              {items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.end}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )
                    }
                  >
                    <it.icon className="size-4.5 shrink-0" />
                    <span className="flex-1 truncate">{it.label}</span>
                    {!!it.count && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">{it.count}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-200 p-3">
      <Link to="/" className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
        <ArrowLeft className="size-4" /> Back to my attendance
      </Link>
      <div className="flex items-center gap-3 px-2">
        <Avatar name={`${user?.firstName} ${user?.lastName}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="truncate text-xs text-slate-500">{user?.profileName}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center border-b border-slate-200 px-5">
          <Logo />
          <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase">Admin</span>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="animate-pop-in relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <Logo />
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <ConnectionBanner />
        <div className="flex h-14 items-center gap-2 px-4 lg:px-8">
          <button type="button" onClick={() => setDrawerOpen(true)} className="-ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="lg:hidden">
            <Logo compact />
          </span>
          <div className="ml-auto flex items-center gap-2">
            <QuickClock />
            <NotificationBell />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-5 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
