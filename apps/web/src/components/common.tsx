'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, ChevronRight, KeyRound, type LucideIcon } from 'lucide-react';
import { EPISODE_STATUS_LABELS, type EpisodeStatus } from '@mas/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Skeleton } from './ui/misc';

type Tone = NonNullable<BadgeProps['tone']>;

const STATUS_TONES: Record<string, Tone> = {
  // episodes
  pending: 'neutral',
  generating: 'info',
  draft: 'indigo',
  review_required: 'warning',
  approved: 'success',
  locked: 'primary',
  // jobs / videos / batches
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  awaiting_confirmation: 'warning',
  narrating: 'info',
  planning: 'info',
  generating_scenes: 'info',
  rendering: 'info',
  estimating: 'neutral',
  partial: 'warning',
  none: 'neutral',
  // sources / outlines
  uploaded: 'neutral',
  extracting: 'info',
  extracted: 'info',
  chunking: 'info',
  embedding: 'info',
  indexed: 'success',
  analyzing: 'info',
  outlined: 'primary',
  // scenes
  done: 'success',
};

const ACTIVE = new Set(['generating', 'running', 'narrating', 'planning', 'generating_scenes', 'rendering', 'extracting', 'chunking', 'embedding', 'analyzing']);

export function humanize(s: string) {
  return (EPISODE_STATUS_LABELS as Record<string, string>)[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const s = status ?? 'none';
  return (
    <Badge tone={STATUS_TONES[s] ?? 'neutral'} className={className}>
      {ACTIVE.has(s) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s === 'none' ? 'No video' : humanize(s)}
    </Badge>
  );
}

export function EpisodeStatusBadge({ status }: { status: EpisodeStatus }) {
  return <StatusBadge status={status} />;
}

export function PageHeader({ title, description, actions, icon: Icon }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'default', href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: LucideIcon; tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger'; href?: string }) {
  const body = (
    <Card className={cn('group relative overflow-hidden p-4 transition-colors', href && 'hover:border-primary/40')}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', { default: 'text-muted-foreground', primary: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-destructive' }[tone])} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Error panel. Missing provider credentials (412) get a dedicated call to action. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (error instanceof ApiError && error.code === 'MISSING_CREDENTIALS') return <MissingCredentialsBanner message={error.message} className={className} />;
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm', className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-medium text-destructive">Something went wrong</p>
        <p className="mt-0.5 text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function MissingCredentialsBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm', className)}>
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="flex-1">
        <p className="font-medium text-warning">Provider credentials required</p>
        <p className="mt-0.5 text-muted-foreground">{message}</p>
      </div>
      <Button size="sm" variant="outline" asChild>
        <Link href="/settings">Open settings</Link>
      </Button>
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="text-xs text-muted-foreground">{total} item{total === 1 ? '' : 's'}</p>;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {actions}
    </div>
  );
}
