'use client';
import * as React from 'react';
import { Music, Plus, Trash2 } from 'lucide-react';
import type { PricingEntry, SettingsResponse } from '@/lib/types';
import { useDeleteMusic, useMusicLibrary, useUploadMusic } from '@/lib/queries/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { Progress, Switch } from '../ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { ConfirmDialog } from '../ui/alert-dialog';
import { EmptyState, ErrorState } from '../common';
import { NumberField, SaveBar, useDraft } from './shared';
import { fileUrl, formatSeconds } from '@/lib/utils';

export function MusicTab() {
  const { data, error } = useMusicLibrary();
  const upload = useUploadMusic();
  const remove = useDeleteMusic();
  const [file, setFile] = React.useState<File | null>(null);
  const [form, setForm] = React.useState({ title: '', mood: '', license: '', licenseUrl: '', attribution: '', kind: 'music' });
  const [rights, setRights] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [del, setDel] = React.useState<string | null>(null);
  const valid = file && form.title && form.license && rights;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a licensed track</CardTitle>
          <CardDescription>Only music and sound effects you have commercial usage rights for. The licence is stored with the track for your records.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Field label="Audio file (MP3, WAV, M4A)" className="md:col-span-2">
            <Input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Mood">
            <Input value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} placeholder="epic, melancholic, divine…" />
          </Field>
          <Field label="Licence">
            <Input value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} placeholder="e.g. Artlist Social licence, CC BY 4.0" />
          </Field>
          <Field label="Licence URL">
            <Input value={form.licenseUrl} onChange={(e) => setForm({ ...form, licenseUrl: e.target.value })} />
          </Field>
          <Field label="Attribution (if required)">
            <Input value={form.attribution} onChange={(e) => setForm({ ...form, attribution: e.target.value })} />
          </Field>
          <Field label="Kind">
            <SimpleSelect value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })} options={[{ value: 'music', label: 'Background music' }, { value: 'sfx', label: 'Sound effect' }]} />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm md:col-span-2">
            <Checkbox checked={rights} onCheckedChange={(c) => setRights(!!c)} className="mt-0.5" />I have commercial usage rights for this track for YouTube Shorts and Instagram Reels.
          </label>
          {upload.isPending && <Progress value={progress} className="md:col-span-2" />}
          <div className="flex justify-end md:col-span-2">
            <Button
              disabled={!valid}
              loading={upload.isPending}
              onClick={() => {
                const fd = new FormData();
                fd.append('file', file!);
                Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
                fd.append('commercialUseConfirmed', 'true');
                upload.mutate(
                  { form: fd, onProgress: setProgress },
                  {
                    onSuccess: () => {
                      setFile(null);
                      setForm({ title: '', mood: '', license: '', licenseUrl: '', attribution: '', kind: 'music' });
                      setRights(false);
                    },
                  },
                );
              }}
            >
              <Plus /> Add track
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && <ErrorState error={error} />}
      {!data?.length ? (
        <EmptyState icon={Music} title="No tracks yet" description="Videos render without background music until you add a licensed track." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Track</TH>
                <TH>Kind</TH>
                <TH>Duration</TH>
                <TH>Licence</TH>
                <TH>Preview</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {data.map((t) => (
                <TR key={t._id}>
                  <TD>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.mood}</div>
                  </TD>
                  <TD>
                    <Badge>{t.kind}</Badge>
                  </TD>
                  <TD className="tabular-nums">{formatSeconds(t.duration)}</TD>
                  <TD className="text-xs">
                    {t.licenseUrl ? (
                      <a href={t.licenseUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {t.license}
                      </a>
                    ) : (
                      t.license
                    )}
                    {t.attribution && <div className="text-muted-foreground">{t.attribution}</div>}
                  </TD>
                  <TD>
                    <audio src={fileUrl(t.filePath)} controls preload="none" className="h-8 w-48" />
                  </TD>
                  <TD className="text-right">
                    <Button size="icon-sm" variant="ghost" onClick={() => setDel(t._id)} aria-label="Delete track">
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Remove this track?" confirmLabel="Remove" destructive loading={remove.isPending} onConfirm={() => del && remove.mutate(del, { onSuccess: () => setDel(null) })} />
    </div>
  );
}

const EMPTY_ENTRY: PricingEntry = { provider: 'google', model: '', category: 'text', unit: 'input_1m_tokens', price: 0, source: '', verified: false };

export function PricingTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.pricing);
  if (!draft) return null;
  const setEntry = (i: number, p: Partial<PricingEntry>) => set({ entries: draft.entries.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  return (
    <div className="space-y-4">
      {data.pricingFreshness.stale && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          Pricing was last verified {data.pricingFreshness.ageDays} days ago. Check the providers’ pricing pages and update the entries and “verified at” date before relying on estimates.
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Pricing catalog</CardTitle>
          <CardDescription>Providers don’t expose prices through their APIs, so cost estimates use this catalog. Entries support effective-date ranges (e.g. scheduled price changes) and per-resolution variants.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Verified at (YYYY-MM-DD)">
              <Input value={draft.verifiedAt} onChange={(e) => set({ verifiedAt: e.target.value })} />
            </Field>
            <NumberField label="Stale after (days)" value={draft.staleAfterDays} min={1} onChange={(v) => set({ staleAfterDays: v })} />
          </div>
          <div className="overflow-auto rounded-md border">
            <Table>
              <THead>
                <TR>
                  {['Provider', 'Model', 'Category', 'Unit', 'Variant', 'Price (USD)', 'From', 'To', 'Verified', 'Source / note', ''].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {draft.entries.map((e, i) => (
                  <TR key={i}>
                    <TD>
                      <Input className="h-8 w-24" value={e.provider} onChange={(x) => setEntry(i, { provider: x.target.value })} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-44 font-mono text-xs" value={e.model} onChange={(x) => setEntry(i, { model: x.target.value })} />
                    </TD>
                    <TD>
                      <SimpleSelect className="h-8 w-28" value={e.category} onValueChange={(v) => setEntry(i, { category: v as PricingEntry['category'] })} options={['text', 'embedding', 'narration', 'video', 'ocr'].map((v) => ({ value: v, label: v }))} />
                    </TD>
                    <TD>
                      <SimpleSelect className="h-8 w-40" value={e.unit} onValueChange={(v) => setEntry(i, { unit: v })} options={['input_1m_tokens', 'output_1m_tokens', '1k_characters', 'second'].map((v) => ({ value: v, label: v }))} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-20" value={e.variant ?? ''} onChange={(x) => setEntry(i, { variant: x.target.value || undefined })} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-24 tabular-nums" type="number" step="0.0001" min={0} value={e.price} onChange={(x) => setEntry(i, { price: Number(x.target.value) })} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-28" value={e.effectiveFrom ?? ''} placeholder="—" onChange={(x) => setEntry(i, { effectiveFrom: x.target.value || undefined })} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-28" value={e.effectiveTo ?? ''} placeholder="—" onChange={(x) => setEntry(i, { effectiveTo: x.target.value || undefined })} />
                    </TD>
                    <TD>
                      <Switch checked={e.verified} onCheckedChange={(c) => setEntry(i, { verified: c })} />
                    </TD>
                    <TD>
                      <Input className="h-8 w-56 text-xs" value={e.source} onChange={(x) => setEntry(i, { source: x.target.value })} />
                      {e.note && <div className="mt-1 max-w-[14rem] text-[10px] text-muted-foreground">{e.note}</div>}
                    </TD>
                    <TD>
                      <Button size="icon-sm" variant="ghost" aria-label="Remove entry" onClick={() => set({ entries: draft.entries.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Button variant="outline" size="sm" onClick={() => set({ entries: [...draft.entries, { ...EMPTY_ENTRY }] })}>
            <Plus /> Add entry
          </Button>
        </CardContent>
      </Card>
      <SaveBar
        section="pricing"
        draft={draft}
        dirty={dirty}
        transform={(d) => ({ verifiedAt: d.verifiedAt, staleAfterDays: d.staleAfterDays, entries: d.entries.map((e: PricingEntry) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== ''))) })}
      />
    </div>
  );
}

export function BudgetTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.budget);
  if (!draft) return null;
  const field = (label: string, key: keyof typeof draft, hint: string) => (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input type="number" min={0} step="0.5" value={draft[key] ?? ''} placeholder="No limit" onChange={(e) => set({ [key]: e.target.value === '' ? null : Number(e.target.value) } as Partial<typeof draft>)} />
        {draft[key] !== null && (
          <Button variant="ghost" size="sm" onClick={() => set({ [key]: null } as Partial<typeof draft>)}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Budget limits (USD)</CardTitle>
          <CardDescription>Batches that would exceed a limit require an explicit second confirmation, and running jobs pause for confirmation instead of overspending.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {field('Daily limit', 'dailyLimit', 'Across all providers, per calendar day')}
          {field('Monthly limit', 'monthlyLimit', 'Across all providers, per calendar month')}
          {field('Max cost per episode', 'maxCostPerEpisode', 'Per video version')}
        </CardContent>
      </Card>
      <SaveBar section="budget" draft={draft} dirty={dirty} />
    </div>
  );
}
