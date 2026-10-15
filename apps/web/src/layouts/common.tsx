import { useQuery } from '@tanstack/react-query';
import { Bell, CloudOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export interface NotificationsResponse {
  items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
  unread: number;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/me/notifications'),
    refetchInterval: 60_000,
  });
}

export function NotificationBell({ className }: { className?: string }) {
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;
  return (
    <Link
      to="/notifications"
      className={`relative inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 ${className ?? ''}`}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

/** Explains delays when the free-tier server is waking up, and shows offline state. */
export function ConnectionBanner() {
  const { serverSlow } = useAuth();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!online)
    return (
      <div className="flex items-center justify-center gap-2 bg-slate-800 px-4 py-1.5 text-xs font-medium text-white" role="status">
        <CloudOff className="size-3.5" /> You’re offline — changes will fail until you reconnect.
      </div>
    );
  if (serverSlow)
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900" role="status">
        <Loader2 className="size-3.5 animate-spin" /> Waking up the server… this can take up to a minute the first time.
      </div>
    );
  return null;
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold text-slate-900">
      <img src="/favicon.svg" alt="" className="size-7" width={28} height={28} />
      {!compact && <span>Attendance</span>}
    </span>
  );
}
