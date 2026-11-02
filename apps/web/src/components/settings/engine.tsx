'use client';
import * as React from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { SettingsResponse } from '@/lib/types';
import { useRemoveLogo, useUploadLogo } from '@/lib/queries/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Slider } from '../ui/misc';
import { NumberField, SaveBar, useDraft } from './shared';
import { fileUrl } from '@/lib/utils';

export function StoryTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.story);
  if (!draft) return null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Story Engine</CardTitle>
          <CardDescription>Chunking, outline segmentation and script quality gates. Changes apply to future jobs.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <NumberField label="Chunk size (chars)" value={draft.chunkChars} min={800} max={12000} step={100} onChange={(v) => set({ chunkChars: v })} />
          <NumberField label="Chunk overlap (chars)" value={draft.chunkOverlapChars} min={0} max={3000} step={50} onChange={(v) => set({ chunkOverlapChars: v })} />
          <NumberField label="Outline segment size (chars)" value={draft.segmentChars} min={10000} max={400000} step={5000} onChange={(v) => set({ segmentChars: v })} />
          <NumberField label="Planning window (events)" value={draft.planningWindowEvents} min={10} max={200} onChange={(v) => set({ planningWindowEvents: v })} />
          <NumberField label="Script concurrency" hint="Applies after worker restart" value={draft.scriptConcurrency} min={1} max={10} onChange={(v) => set({ scriptConcurrency: v })} />
          <NumberField label="Max attempts per script" value={draft.maxScriptAttempts} min={1} max={6} onChange={(v) => set({ maxScriptAttempts: v })} />
          <Field label={`Quality threshold · ${draft.qualityThreshold}/10`} hint="Scripts below this are saved as “Review Required”">
            <Slider min={1} max={10} step={0.5} value={[draft.qualityThreshold]} onValueChange={([v]) => set({ qualityThreshold: v! })} />
          </Field>
          <Field label={`Duplicate similarity · ${draft.duplicateSimilarity.toFixed(2)}`} hint="Narrations more similar than this to another episode are rejected">
            <Slider min={0.5} max={0.999} step={0.005} value={[draft.duplicateSimilarity]} onValueChange={([v]) => set({ duplicateSimilarity: v! })} />
          </Field>
          <Field label="OCR engine">
            <SimpleSelect
              value={draft.ocrEngine === 'gemini' ? 'llm' : draft.ocrEngine}
              onValueChange={(v) => set({ ocrEngine: v as 'llm' })}
              options={[
                { value: 'llm', label: 'Vision model of the Text AI provider' },
                { value: 'tesseract', label: 'Tesseract (local, must be installed)' },
              ]}
            />
          </Field>
          <Field label="Speech rate (learned)" hint={`${draft.calibrationSamples} audio samples measured`}>
            <Input value={`${draft.syllablesPerSecond.toFixed(2)} syllables/s`} disabled />
          </Field>
        </CardContent>
      </Card>
      <SaveBar
        section="story"
        draft={draft}
        dirty={dirty}
        transform={(d) => {
          const { syllablesPerSecond: _a, calibrationSamples: _b, ...rest } = d;
          return rest;
        }}
      />
    </div>
  );
}

export function RenderTab({ data }: { data: SettingsResponse }) {
  const { draft, set, dirty } = useDraft(data.settings.render);
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  if (!draft) return null;
  const sub = (p: Partial<typeof draft.subtitles>) => set({ subtitles: { ...draft.subtitles, ...p } });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Output & timing</CardTitle>
          <CardDescription>Final videos are 1080×1920 H.264/AAC MP4, optimised for YouTube Shorts and Instagram Reels.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <NumberField label="Target duration (s)" value={draft.targetDuration} min={15} max={180} onChange={(v) => set({ targetDuration: v })} />
          <NumberField label="Acceptable ± (s)" value={draft.durationTolerance} min={1} max={30} onChange={(v) => set({ durationTolerance: v })} />
          <Field label={`Max narration speed adjust · ±${Math.round(draft.maxSpeedAdjust * 100)}%`}>
            <Slider min={0} max={0.15} step={0.01} value={[draft.maxSpeedAdjust]} onValueChange={([v]) => set({ maxSpeedAdjust: v! })} />
          </Field>
          <Field label="Frame rate">
            <SimpleSelect value={String(draft.fps)} onValueChange={(v) => set({ fps: Number(v) })} options={['24', '25', '30'].map((v) => ({ value: v, label: `${v} fps` }))} />
          </Field>
          <NumberField label="Quality (CRF, lower = better)" value={draft.crf} min={14} max={28} onChange={(v) => set({ crf: v })} />
          <Field label="Encoder preset">
            <SimpleSelect value={draft.preset} onValueChange={(v) => set({ preset: v })} options={['ultrafast', 'veryfast', 'fast', 'medium', 'slow'].map((v) => ({ value: v, label: v }))} />
          </Field>
          <Field label="Transition">
            <SimpleSelect value={draft.transition} onValueChange={(v) => set({ transition: v })} options={['fade', 'fadeblack', 'dissolve', 'smoothleft', 'smoothup', 'circleopen', 'none'].map((v) => ({ value: v, label: v }))} />
          </Field>
          <Field label={`Transition length · ${draft.transitionDuration.toFixed(2)}s`}>
            <Slider min={0} max={1.5} step={0.05} value={[draft.transitionDuration]} onValueChange={([v]) => set({ transitionDuration: v! })} />
          </Field>
          <NumberField label="Narration loudness (LUFS)" value={draft.narrationLoudnessLufs} min={-24} max={-9} onChange={(v) => set({ narrationLoudnessLufs: v })} />
          <Field label={`Default music volume · ${Math.round(draft.musicVolume * 100)}%`}>
            <Slider min={0} max={1} step={0.01} value={[draft.musicVolume]} onValueChange={([v]) => set({ musicVolume: v! })} />
          </Field>
          <Field label={`Default SFX intensity · ${Math.round(draft.sfxIntensity * 100)}%`}>
            <Slider min={0} max={1} step={0.01} value={[draft.sfxIntensity]} onValueChange={([v]) => set({ sfxIntensity: v! })} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Subtitle defaults</CardTitle>
          <CardDescription>Hindi captions are rendered with proper Devanagari shaping and kept clear of the platforms’ bottom and right-side UI.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Font">
            <Input value={draft.subtitles.font} onChange={(e) => sub({ font: e.target.value })} />
          </Field>
          <NumberField label="Font size" value={draft.subtitles.fontSize} min={24} max={120} onChange={(v) => sub({ fontSize: v })} />
          <Field label="Animation">
            <SimpleSelect value={draft.subtitles.animation} onValueChange={(v) => sub({ animation: v as 'pop' })} options={['none', 'pop', 'karaoke', 'fade'].map((v) => ({ value: v, label: v }))} />
          </Field>
          <Field label="Text colour">
            <div className="flex gap-2">
              <input type="color" className="h-9 w-10 rounded border bg-transparent" value={draft.subtitles.textColor} onChange={(e) => sub({ textColor: e.target.value.toUpperCase() })} />
              <Input value={draft.subtitles.textColor} onChange={(e) => sub({ textColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Highlight colour">
            <div className="flex gap-2">
              <input type="color" className="h-9 w-10 rounded border bg-transparent" value={draft.subtitles.highlightColor} onChange={(e) => sub({ highlightColor: e.target.value.toUpperCase() })} />
              <Input value={draft.subtitles.highlightColor} onChange={(e) => sub({ highlightColor: e.target.value })} />
            </div>
          </Field>
          <Field label={`Background opacity · ${Math.round(draft.subtitles.backgroundOpacity * 100)}%`}>
            <Slider min={0} max={1} step={0.05} value={[draft.subtitles.backgroundOpacity]} onValueChange={([v]) => sub({ backgroundOpacity: v! })} />
          </Field>
          <Field label={`Position from bottom · ${Math.round(draft.subtitles.positionFromBottom * 100)}%`}>
            <Slider min={0.12} max={0.6} step={0.01} value={[draft.subtitles.positionFromBottom]} onValueChange={([v]) => sub({ positionFromBottom: v! })} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Channel branding</CardTitle>
          <CardDescription>Your own logo, overlaid subtly. Provider watermarks / AI provenance markers are never removed, cropped or obscured.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-surface-sunken">
            {draft.logoKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(draft.logoKey)} alt="Logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <label className="cursor-pointer">
            <span className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm hover:bg-accent">
              <ImagePlus className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Upload PNG logo'}
            </span>
            <input
              type="file"
              accept="image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = '';
              }}
            />
          </label>
          {draft.logoKey && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 /> Remove
            </Button>
          )}
          <Field label="Logo position" className="w-40">
            <SimpleSelect value={draft.logoPosition} onValueChange={(v) => set({ logoPosition: v as 'top-left' })} options={[{ value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }]} />
          </Field>
        </CardContent>
      </Card>
      <SaveBar
        section="render"
        draft={draft}
        dirty={dirty}
        transform={(d) => {
          const { logoKey: _l, ...rest } = d;
          return rest;
        }}
      />
    </div>
  );
}
