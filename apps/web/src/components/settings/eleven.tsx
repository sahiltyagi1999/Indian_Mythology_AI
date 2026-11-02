'use client';
import * as React from 'react';
import { FlaskConical, Volume2 } from 'lucide-react';
import type { ElevenTestResult, SettingsResponse } from '@/lib/types';
import { useTestEleven, useTestVoice } from '@/lib/queries/misc';
import { useVoices } from '@/lib/queries/video';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Slider, Switch } from '../ui/misc';
import { Badge } from '../ui/badge';
import { SaveBar, SecretInput, useDraft } from './shared';
import { formatDate, voiceLabel } from '@/lib/utils';

export function ElevenTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.elevenlabs);
  const configured = data.secrets.elevenlabs.apiKey.configured;
  const voices = useVoices(configured);
  const test = useTestEleven();
  const testVoice = useTestVoice();
  const [result, setResult] = React.useState<ElevenTestResult | null>(null);
  const [sample, setSample] = React.useState('');
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  if (!draft) return null;
  const slider = (label: string, key: 'stability' | 'similarityBoost' | 'style' | 'speed', min = 0, max = 1, step = 0.01) => (
    <Field label={`${label} · ${draft[key].toFixed(2)}`}>
      <Slider min={min} max={max} step={step} value={[draft[key]]} onValueChange={([v]) => set({ [key]: v } as Partial<typeof draft>)} />
    </Field>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>ElevenLabs narration</CardTitle>
            <CardDescription>Hindi text-to-speech with character-level timestamps (used for subtitles and scene sync). Audio is cached per script version, voice and settings.</CardDescription>
          </div>
          <Button variant="outline" disabled={!configured} loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: setResult })}>
            <FlaskConical /> Test connection
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretInput provider="elevenlabs" label="ElevenLabs API key" info={data.secrets.elevenlabs.apiKey} />
          {result && (
            <div className="grid gap-3 rounded-md border bg-surface-sunken/60 p-3 text-sm md:grid-cols-2">
              <div>
                <div className="font-medium">
                  Plan: {result.subscription.tier} <Badge tone="success">{result.subscription.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {result.subscription.remaining.toLocaleString()} of {result.subscription.characterLimit.toLocaleString()} characters left
                  {result.subscription.resetsAt ? ` · resets ${formatDate(result.subscription.resetsAt)}` : ''}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Auto model: {result.resolvedModel}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {result.models.map((m) => (
                  <Badge key={m.id} tone={m.hindi ? 'success' : 'neutral'}>
                    {m.id}
                    {m.hindi ? ' · hi' : ''}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Voice & delivery</CardTitle>
          <CardDescription>Default: deep, majestic, dramatic Hindi storyteller. Narration styles nudge these per episode.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Default narrator voice">
            <SimpleSelect
              value={draft.voiceId}
              onValueChange={(v) => set({ voiceId: v })}
              placeholder={configured ? (voices.isLoading ? 'Loading voices…' : 'Select a voice') : 'Add an API key first'}
              options={[...(draft.voiceId && !voices.data?.some((v) => v.voiceId === draft.voiceId) ? [{ value: draft.voiceId, label: draft.voiceId }] : []), ...(voices.data ?? []).map((v) => ({ value: v.voiceId, label: voiceLabel(v) }))]}
            />
          </Field>
          <Field label="Model">
            <SimpleSelect
              value={draft.model}
              onValueChange={(v) => set({ model: v })}
              options={[{ value: '', label: 'Auto (best Hindi-capable model)' }, ...(draft.model && !result?.models.some((m) => m.id === draft.model) ? [{ value: draft.model, label: draft.model }] : []), ...(result?.models ?? []).filter((m) => m.hindi).map((m) => ({ value: m.id, label: m.name }))]}
            />
          </Field>
          <Field label="Language code">
            <Input value={draft.languageCode} onChange={(e) => set({ languageCode: e.target.value })} />
          </Field>
          <Field label="Output format">
            <SimpleSelect value={draft.outputFormat} onValueChange={(v) => set({ outputFormat: v })} options={['mp3_44100_128', 'mp3_44100_192', 'wav_44100', 'pcm_24000'].map((v) => ({ value: v, label: v }))} />
          </Field>
          {slider('Stability', 'stability')}
          {slider('Similarity', 'similarityBoost')}
          {slider('Style intensity', 'style')}
          {slider('Speed', 'speed', 0.7, 1.2, 0.01)}
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={draft.useSpeakerBoost} onCheckedChange={(c) => set({ useSpeakerBoost: c })} /> Speaker boost
          </label>
        </CardContent>
      </Card>
      <SaveBar section="elevenlabs" draft={draft} dirty={dirty} />
      <Card>
        <CardHeader>
          <CardTitle>Test voice generation</CardTitle>
          <CardDescription>Generates a short sample with the saved settings (a few characters of credit; identical samples are cached).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input className="font-hindi" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="कुरुक्षेत्र की धरती पर, एक ऐसा युद्ध होने वाला था, जिसे इतिहास कभी नहीं भूलेगा।" maxLength={300} />
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={!configured} loading={testVoice.isPending} onClick={() => testVoice.mutate({ text: sample || undefined, voiceId: draft.voiceId || undefined }, { onSuccess: (r) => setAudioUrl(`${r.url}?t=${Date.now()}`) })}>
              <Volume2 /> Generate sample
            </Button>
            {audioUrl && <audio src={audioUrl} controls autoPlay className="h-9" />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
