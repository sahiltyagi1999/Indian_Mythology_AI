import * as React from 'react';
import { cn } from '@/lib/utils';

/** Renders narration with hook / ending / teaser segments highlighted where they occur verbatim. */
export function HighlightedNarration({ text, hook, ending, teaser, className }: { text: string; hook?: string; ending?: string; teaser?: string; className?: string }) {
  const marks = [
    { s: hook, cls: 'bg-primary/15 text-foreground decoration-primary', label: 'Hook' },
    { s: ending, cls: 'bg-info/10 text-foreground', label: 'Ending' },
    { s: teaser, cls: 'bg-secondary/50 text-foreground', label: 'Teaser' },
  ]
    .filter((m) => m.s && m.s.trim().length > 3)
    .map((m) => ({ ...m, i: text.indexOf(m.s!.trim()) }))
    .filter((m) => m.i >= 0)
    .sort((a, b) => a.i - b.i);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.i < cursor) continue;
    if (m.i > cursor) parts.push(text.slice(cursor, m.i));
    const seg = m.s!.trim();
    parts.push(
      <mark key={m.label} title={m.label} className={cn('rounded px-0.5', m.cls)}>
        {seg}
      </mark>,
    );
    cursor = m.i + seg.length;
  }
  parts.push(text.slice(cursor));
  return <p className={cn('whitespace-pre-wrap font-hindi text-lg leading-[2] text-foreground/95', className)}>{parts}</p>;
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-primary/40" /> Hook
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-info/40" /> Ending
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-secondary" /> Next-episode teaser
      </span>
    </div>
  );
}
