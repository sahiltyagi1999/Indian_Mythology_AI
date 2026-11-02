'use client';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FlaskConical, Sparkles } from 'lucide-react';
import type { AllSettings, GoogleTestResult, SettingsResponse } from '@/lib/types';
import { useGoogleModels, useTestGoogle } from '@/lib/queries/misc';
import { useVideoProviders } from '@/lib/queries/video';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Badge } from '../ui/badge';
import { KeyValue } from '../common';
import { SaveBar, SecretInput, useDraft } from './shared';

const ROLES: { key: keyof AllSettings['google']; role: string; label: string; hint: string }[] = [
  { key: 'textModel', role: 'text', label: 'Script writing model', hint: 'Writes scripts and picks narration styles' },
  { key: 'analysisModel', role: 'analysis', label: 'Source analysis model', hint: 'Outline, chronology, characters (strongest model recommended)' },
  { key: 'qualityModel', role: 'quality', label: 'Quality evaluation model', hint: 'Independent fact-check and scoring' },
  { key: 'ocrModel', role: 'ocr', label: 'OCR model', hint: 'Reads scanned / broken-font pages' },
  { key: 'embeddingModel', role: 'embedding', label: 'Embedding model', hint: 'Semantic retrieval (Qdrant)' },
];

export function GoogleTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.google);
  const configured = data.secrets.google.apiKey.configured;
  const models = useGoogleModels(configured);
  const providers = useVideoProviders();
  const test = useTestGoogle();
  const [result, setResult] = React.useState<GoogleTestResult | null>(null);
  if (!draft) return null;
  const textModels = (models.data?.models ?? []).filter((m) => m.supportedGenerationMethods.includes('generateContent'));
  const embedModels = (models.data?.models ?? []).filter((m) => m.supportedGenerationMethods.some((g) => /embed/i.test(g)));
  const caps = result?.video.capabilities;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Google AI (Gemini API)</CardTitle>
            <CardDescription>
              An API key from Google AI Studio with billing enabled. A Google AI Pro consumer subscription does <strong>not</strong> include API credits; video generation requires the paid API tier.
            </CardDescription>
          </div>
          <Button variant="outline" disabled={!configured} loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: setResult })}>
            <FlaskConical /> Test & check models
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretInput provider="google" label="Gemini API key" info={data.secrets.google.apiKey} />
          {result && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border bg-surface-sunken/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-success" /> {result.modelCount} models visible to this key
                </div>
                <KeyValue items={Object.entries(result.resolved).map(([k, v]) => [k, <code key={k} className={`text-xs ${String(v).startsWith('unavailable') ? 'text-destructive' : ''}`}>{v ?? '—'}</code>])} />
              </div>
              <div className="rounded-md border bg-surface-sunken/60 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  {result.video.available ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                  Video: {result.video.model ?? 'not resolved'}
                </div>
                <p className="text-xs text-muted-foreground">{result.video.message}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gemini text models</CardTitle>
          <CardDescription>
            Used only when the Text AI provider is set to Google ({data.settings.llm.provider === 'google' ? 'active now' : 'currently OpenAI — see the Text AI tab'}). “Auto” picks the newest stable model per role from the live models list.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {ROLES.map((r) => {
            const pool = r.role === 'embedding' ? embedModels : textModels;
            const current = draft[r.key] as string;
            return (
              <Field key={r.key} label={r.label} hint={r.hint}>
                <SimpleSelect
                  value={current}
                  onValueChange={(v) => set({ [r.key]: v } as Partial<AllSettings['google']>)}
                  placeholder={configured ? 'Auto' : 'Add an API key to list models'}
                  options={[
                    { value: '', label: `Auto (latest stable)${result?.resolved[r.role] && !String(result.resolved[r.role]).startsWith('unavailable') ? ` → ${result.resolved[r.role]}` : ''}` },
                    ...(current && !pool.some((m) => m.id === current) ? [{ value: current, label: current }] : []),
                    ...pool.map((m) => ({ value: m.id, label: m.displayName && m.displayName !== m.id ? `${m.id} · ${m.displayName}` : m.id })),
                  ]}
                />
              </Field>
            );
          })}
          <Field label="Embedding dimensions" hint="Changing this requires a new Qdrant collection">
            <SimpleSelect value={String(draft.embeddingDimensions)} onValueChange={(v) => set({ embeddingDimensions: Number(v) as 768 })} options={['768', '1536', '3072'].map((v) => ({ value: v, label: v }))} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Video generation provider
          </CardTitle>
          <CardDescription>Providers are pluggable. The studio never switches to a different (possibly more expensive) provider on its own.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Provider">
              <SimpleSelect value={draft.videoProvider} onValueChange={(v) => set({ videoProvider: v })} options={(providers.data?.providers ?? [{ id: draft.videoProvider, label: draft.videoProvider }]).map((p) => ({ value: p.id, label: p.label }))} />
            </Field>
            <Field label="Video model">
              <SimpleSelect
                value={draft.videoModel}
                onValueChange={(v) => set({ videoModel: v })}
                options={[
                  { value: '', label: 'Auto (discover from models list)' },
                  ...(draft.videoModel && !(models.data?.videoModels ?? []).includes(draft.videoModel) ? [{ value: draft.videoModel, label: draft.videoModel }] : []),
                  ...(models.data?.videoModels ?? []).map((m) => ({ value: m, label: m })),
                ]}
              />
            </Field>
            <Field label="Default resolution">
              <SimpleSelect value={draft.videoResolution} onValueChange={(v) => set({ videoResolution: v as '720p' })} options={[{ value: '720p', label: '720p (native)' }, { value: '1080p', label: '1080p (upscaled)' }]} />
            </Field>
          </div>
          {caps && (
            <div className="rounded-md border bg-surface-sunken/60 p-4 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{caps.displayName}</span>
                {caps.requiresPaidTier && <Badge tone="warning">Paid API tier required</Badge>}
                <Badge>
                  {caps.minClipSeconds}–{caps.maxClipSeconds}s clips
                </Badge>
                <Badge>{caps.aspectRatios.join(' · ')}</Badge>
                <Badge>{caps.resolutions.join(' / ')}</Badge>
                {caps.referenceImages.supported && <Badge tone="success">Reference images (≤{caps.referenceImages.max})</Badge>}
                {caps.generatesAudio && <Badge tone="info">Generates ambient audio</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">Watermark: {caps.watermark}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {caps.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <a href={caps.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Provider docs (verified {caps.verifiedAt}) <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {!caps && <p className="text-xs text-muted-foreground">Run “Test & check models” to verify availability and capabilities for your key.</p>}
        </CardContent>
      </Card>
      <SaveBar section="google" draft={draft} dirty={dirty} />
    </div>
  );
}
