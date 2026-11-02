'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronsLeft, ChevronsRight, Loader2, Sparkles } from 'lucide-react';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip } from '../ui/misc';
import { NAV, titleFor } from './nav';
import type { JobsPage } from '@/lib/types';

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      return { ok: res.ok && !!body?.ok, body };
    },
    refetchInterval: 30_000,
    retry: false,
  });
}

function QueueIndicator() {
  const { data } = useQuery({
    queryKey: ['jobs', 'running-indicator'],
    queryFn: () => get<JobsPage>('/jobs', { status: ['running', 'queued'], pageSize: 1 }),
    refetchInterval: 5000,
  });
  const running = data?.counts?.running ?? 0;
  const queued = data?.counts?.queued ?? 0;
  return (
    <Link
      href="/queue"
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary/40',
        running > 0 ? 'border-info/30 bg-info/10 text-info' : 'text-muted-foreground',
      )}
    >
      {running > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
      <span className="tabular-nums">
        {running} running{queued ? ` · ${queued} queued` : ''}
      </span>
    </Link>
  );
}

function HealthDot() {
  const { data, isLoading } = useHealth();
  const b = data?.body;
  const tip = isLoading
    ? 'Checking system health…'
    : b
      ? `MongoDB: ${b.mongo?.state ?? '?'} · Redis: ${b.redis?.ok ? 'ok' : 'down'} · Vector: ${b.vector?.ok ? 'ok' : 'down'}`
      : 'API unreachable';
  return (
    <Tooltip content={tip} side="bottom">
      <Link href="/settings" className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('h-2 w-2 rounded-full', isLoading ? 'bg-muted-foreground' : data?.ok ? 'bg-success shadow-[0_0_8px_hsl(var(--success))]' : 'bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]')} />
        <span className="hidden sm:inline">{isLoading ? 'Checking' : data?.ok ? 'Systems OK' : 'Degraded'}</span>
      </Link>
    </Tooltip>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('mas.sidebar') === 'collapsed');
    } catch {
      /* storage unavailable */
    }
    const mq = window.matchMedia('(max-width: 1023px)');
    if (mq.matches) setCollapsed(true);
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('mas.sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <div className="flex min-h-screen">
      <aside className={cn('sticky top-0 flex h-screen shrink-0 flex-col border-r bg-surface-sunken transition-[width] duration-200', collapsed ? 'w-16' : 'w-60')}>
        <div className={cn('flex h-14 items-center gap-2 border-b px-4', collapsed && 'justify-center px-0')}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#b0602a] text-primary-foreground shadow-[0_0_20px_-4px_hsl(var(--primary))]">
            <Sparkles className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">Mahabharat</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">AI Studio</div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              {!collapsed && <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">{g}</div>}
              {NAV.filter((n) => n.group === g).map((n) => {
                const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
                const link = (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
                    <n.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{n.label}</span>}
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={n.href} content={n.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </div>
          ))}
        </nav>
        <button onClick={toggle} className="flex h-10 items-center justify-center gap-2 border-t text-xs text-muted-foreground hover:text-foreground" aria-label="Toggle sidebar">
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Collapse
            </>
          )}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-6 backdrop-blur">
          <div className="truncate text-sm font-medium text-muted-foreground">{titleFor(pathname)}</div>
          <div className="flex items-center gap-4">
            <QueueIndicator />
            <HealthDot />
          </div>
        </header>
        <main className="surface-gradient flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
