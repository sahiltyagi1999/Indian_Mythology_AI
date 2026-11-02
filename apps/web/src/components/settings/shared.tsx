'use client';
import * as React from 'react';
import { CheckCircle2, KeyRound, Save, XCircle } from 'lucide-react';
import type { SecretInfo } from '@/lib/types';
import { useSaveSecret, useSaveSettings } from '@/lib/queries/misc';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { Badge } from '../ui/badge';

export function useDraft<T extends object>(initial: T | undefined) {
  const [draft, setDraft] = React.useState<T | undefined>(initial);
  const key = JSON.stringify(initial);
  React.useEffect(() => setDraft(initial), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== key;
  const set = (p: Partial<T>) => setDraft((d) => (d ? { ...d, ...p } : d));
  return { draft, set, setDraft, dirty };
}

export function SaveBar({ section, draft, dirty, transform }: { section: string; draft: object | undefined; dirty: boolean; transform?: (d: any) => Record<string, unknown> }) {
  const save = useSaveSettings();
  return (
    <div className="flex justify-end">
      <Button disabled={!dirty || !draft} loading={save.isPending} onClick={() => draft && save.mutate({ section, patch: transform ? transform(draft) : (draft as Record<string, unknown>) })}>
        <Save /> Save {section} settings
      </Button>
    </div>
  );
}

export function StatusLine({ ok, label, detail }: { ok: boolean | null; label: string; detail?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-surface-sunken/60 p-3">
      {ok === null ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-muted-foreground" /> : ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className="break-words text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

/** Write-only API key input. The stored key is never sent back to the browser — only its masked form. */
export function SecretInput({ provider, info, label }: { provider: 'google' | 'openai' | 'elevenlabs'; info?: SecretInfo; label: string }) {
  const [value, setValue] = React.useState('');
  const save = useSaveSecret();
  return (
    <Field
      label={label}
      hint={
        info?.configured
          ? `Stored ${info.origin === 'database' ? 'encrypted in MongoDB' : 'in an environment variable'} · ${info.masked}. Enter a new key to replace it.`
          : 'Not configured. Keys are encrypted server-side (AES-256-GCM) and never returned to the browser.'
      }
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="password" autoComplete="off" spellCheck={false} className="pl-8 font-mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder={info?.configured ? info.masked ?? '••••' : 'Paste API key'} />
        </div>
        <Button disabled={!value.trim()} loading={save.isPending && !!save.variables?.value} onClick={() => save.mutate({ provider, value: value.trim() }, { onSuccess: () => setValue('') })}>
          Save key
        </Button>
        {info?.origin === 'database' && (
          <Button variant="outline" loading={save.isPending && save.variables?.value === null} onClick={() => save.mutate({ provider, value: null })}>
            Remove
          </Button>
        )}
      </div>
      {info && (
        <div className="mt-1">
          <Badge tone={info.configured ? 'success' : 'warning'}>{info.configured ? 'Configured' : 'Missing'}</Badge>
        </div>
      )}
    </Field>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, max, hint }: { label: string; value: number | null | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input type="number" step={step} min={min} max={max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}
