'use client';
import * as React from 'react';
import { CheckCircle2, FlaskConical } from 'lucide-react';
import type { AllSettings, OpenAITestResult, SettingsResponse } from '@/lib/types';
import { useOpenAIModels, useSaveSettings, useTestOpenAI } from '@/lib/queries/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Badge } from '../ui/badge';
import { KeyValue } from '../common';
import { SaveBar, SecretInput, useDraft } from './shared';

type OpenAIKey = keyof AllSettings['openai'];

const ROLES: { key: OpenAIKey; role: keyof OpenAITestResult['resolved']; label: string; hint: string }[] = [
  { key: 'analysisModel', role: 'analysis', label: 'Source analysis', hint: 'Master outline, chronology, character database — Sol family' },
  { key: 'textModel', role: 'text', label: 'Script writing', hint: 'Hindi narration and scene planning — Terra family' },
  { key: 'qualityModel', role: 'quality', label: 'Quality & fact-check', hint: 'Independent evaluation against the source — Sol family' },
  { key: 'ocrModel', role: 'ocr', label: 'OCR (vision)', hint: 'Scanned / broken-font pages — Terra family' },
  { key: 'lightModel', role: 'light', label: 'Light tasks', hint: 'Hinglish copy and style selection — Luna family' },
  { key: 'embeddingModel', role: 'embedding', label: 'Embeddings', hint: 'Semantic retrieval (Qdrant) — text-embedding-3-small' },
];

export function OpenAITab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.openai);
  const configured = data.secrets.openai.apiKey.configured;
  const provider = data.settings.llm.provider;
  const models = useOpenAIModels(configured);
  const test = useTestOpenAI();
  const saveProvider = useSaveSettings();
  const [result, setResult] = React.useState<OpenAITestResult | null>(null);
  if (!draft) return null;
  const all = models.data?.models ?? [];
  const textPool = all.filter((m) => /^gpt-/.test(m.id) && !/-\d{4}-\d{2}-\d{2}$/.test(m.id));
  const embedPool = all.filter((m) => m.id.startsWith('text-embedding-'));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Text AI provider</CardTitle>
          <CardDescription>
            Used for everything except video: outline, characters, Hindi scripts, quality checks, Hinglish copies, scene planning, OCR and embeddings. Video generation always uses the Google video model.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {(['openai', 'google'] as const).map((p) => (
            <Button key={p} variant={provider === p ? 'default' : 'outline'} loading={saveProvider.isPending && saveProvider.variables?.patch.provider === p} onClick={() => provider !== p && saveProvider.mutate({ section: 'llm', patch: { provider: p } })}>
              {p === 'openai' ? 'OpenAI (ChatGPT models)' : 'Google Gemini'}
            </Button>
          ))}
          <p className="text-xs text-muted-foreground">Sources keep the embedding model they were indexed with, so switching later never mixes vector spaces.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              OpenAI API {provider === 'openai' && <Badge tone="success">Active</Badge>}
            </CardTitle>
            <CardDescription>An API key from platform.openai.com with credits. A ChatGPT Plus/Pro subscription does not include API usage.</CardDescription>
          </div>
          <Button variant="outline" disabled={!configured} loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: setResult })}>
            <FlaskConical /> Test & check models
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretInput provider="openai" label="OpenAI API key" info={data.secrets.openai.apiKey} />
          {result && (
            <div className="rounded-md border bg-surface-sunken/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-success" /> {result.modelCount} models visible to this key
              </div>
              <KeyValue items={Object.entries(result.resolved).map(([k, v]) => [k, <code key={k} className={`text-xs ${v.startsWith('unavailable') ? 'text-destructive' : ''}`}>{v}</code>])} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models per role</CardTitle>
          <CardDescription>“Auto” picks the newest live model of the recommended family for each role, skipping dated snapshots and models past their shutdown date.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {ROLES.map((r) => {
            const pool = r.role === 'embedding' ? embedPool : textPool;
            const current = draft[r.key] as string;
            const auto = result?.resolved[r.role];
            return (
              <Field key={r.key} label={r.label} hint={r.hint}>
                <SimpleSelect
                  value={current}
                  onValueChange={(v) => set({ [r.key]: v } as Partial<AllSettings['openai']>)}
                  options={[
                    { value: '', label: `Auto${auto && !auto.startsWith('unavailable') ? ` → ${auto}` : ''}` },
                    ...(current && !pool.some((m) => m.id === current) ? [{ value: current, label: current }] : []),
                    ...pool.map((m) => ({ value: m.id, label: m.shutdownDate ? `${m.id} (retires ${m.shutdownDate})` : m.id })),
                  ]}
                />
              </Field>
            );
          })}
          <Field label="Embedding dimensions" hint="Must match the Qdrant collection (768 by default)">
            <SimpleSelect value={String(draft.embeddingDimensions)} onValueChange={(v) => set({ embeddingDimensions: Number(v) as 768 })} options={['768', '1536', '3072'].map((v) => ({ value: v, label: v }))} />
          </Field>
        </CardContent>
      </Card>
      <SaveBar section="openai" draft={draft} dirty={dirty} />
    </div>
  );
}
