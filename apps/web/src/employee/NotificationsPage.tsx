import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui/Display';
import { useNotifications } from '../layouts/common';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/format';

export default function NotificationsPage() {
  const q = useNotifications();
  const qc = useQueryClient();
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  const mutate = markAll.mutate;

  // Opening the page marks everything as read after a short delay (so unread items are still highlighted).
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => mutate(), 2500);
    return () => clearTimeout(t);
  }, [unread, mutate]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        actions={
          unread > 0 && (
            <Button variant="ghost" size="sm" icon={<CheckCheck className="size-4" />} onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          )
        }
      />
      <Card>
        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Bell className="size-6" />} title="You’re all caught up" description="Approvals, rejections and reminders will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.items.map((n) => {
              const content = (
                <div className={clsx('flex gap-3 px-4 py-3.5 sm:px-5', !n.readAt && 'bg-brand-50/40')}>
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{relativeTime(n.createdAt)}</p>
                  </div>
                </div>
              );
              return <li key={n.id}>{n.link ? <Link to={n.link} className="block hover:bg-slate-50">{content}</Link> : content}</li>;
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
