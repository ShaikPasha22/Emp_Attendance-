import { clsx } from 'clsx';
import { CalendarDays, FileText, Home, LayoutDashboard, User } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { ButtonLink } from '../components/ui/Button';
import { useAuth } from '../lib/auth';
import { ConnectionBanner, Logo, NotificationBell } from './common';

const tabs = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/attendance', label: 'Attendance', icon: CalendarDays },
  { to: '/requests', label: 'Requests', icon: FileText },
  { to: '/profile', label: 'Profile', icon: User },
];

/** Mobile-first shell: bottom tab bar on phones, top navigation on larger screens. */
export function EmployeeLayout() {
  const { user } = useAuth();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <ConnectionBanner />
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Logo />
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  clsx('rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {user?.canAccessDashboard && (
              <ButtonLink to="/admin" variant="secondary" size="sm" icon={<LayoutDashboard className="size-4" />}>
                <span className="hidden sm:inline">Dashboard</span>
              </ButtonLink>
            )}
            <NotificationBell />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 pt-4 pb-28 md:pt-6 md:pb-10">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden" aria-label="Main">
        <ul className="grid grid-cols-4">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  clsx('flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx('rounded-full px-4 py-1 transition-colors', isActive && 'bg-brand-50')}>
                      <t.icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
