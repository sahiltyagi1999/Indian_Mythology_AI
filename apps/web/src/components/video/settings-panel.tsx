'use client';
import * as React from 'react';
import { Play, Square } from 'lucide-react';
import { NARRATION_STYLES, VISUAL_STYLES, type VideoGenerationSettings } from '@mas/shared';
import { useMusic, useVideoProviders, useVoices } from '@/lib/queries/video';
import { ApiError } from '@/lib/api';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Slider } from '../ui/misc';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { MissingCredentialsBanner } from '../common';

export function VideoSettingsPanel({ value, onChange, concurrency, onConcurrency }: { value: VideoGenerationSettings; onChange: (v: VideoGenerationSettings) => void; concurrency: number; onConcurrency: (n: number) => void }) {
  const voices = useVoices();
  const providers = useVideoProviders();
  const music = useMusic();
  const [playing, setPlaying] = React.useState<HTMLAudioElement | null>(null);
  const set = (p: Partial<VideoGenerationSettings>) => onChange({ ...value, ...p });
  const sub = (p: Partial<VideoGenerationSettings['subtitles']>) => onChange({ ...value, subtitles: { ...value.subtitles, ...p } });
  const voice = voices.data?.find((v) => v.voiceId === value.voiceId);
  const caps = providers.data?.providers.find((p) => p.id === value.videoProvider)?.capabilities;

  const preview = () => {
    if (playing) {
      playing.pause();
      setPlaying(null);
      return;
    }
    if (!voice?.previewUrl) return;
    const a = new Audio(voice.previewUrl);
    a.onended = () => setPlaying(null);
    void a.play();
    setPlaying(a);
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Narration</h3>
        {voices.error instanceof ApiError && voices.error.code === 'MISSING_CREDENTIALS' && <MissingCredentialsBanner message={voices.error.message} />}
        <Field label="Narrator voice (ElevenLabs)">
          <div className="flex gap-2">
            <SimpleSelect
              className="flex-1"
              value={value.voiceId}
              onValueChange={(v) => set({ voiceId: v })}
              placeholder={voices.isLoading ? 'Loading voices…' : 'Use default voice from settings'}
              options={[{ value: '', label: 'Default voice from settings' }, ...(voices.data ?? []).map((v) => ({ value: v.voiceId, label: `${v.name}${v.labels?.accent ? ` · ${v.labels.accent}` : ''}${v.category ? ` (${v.category})` : ''}` }))]}
            />
            <Button size="icon" variant="outline" disabled={!voice?.previewUrl} onClick={preview} aria-label="Preview voice">
              {playing ? <Square /> : <Play />}
            </Button>
          </div>
        </Field>
        <Field label="Narration style override">
          <SimpleSelect
            value={value.narrationStyleOverride ?? ''}
            onValueChange={(v) => set({ narrationStyleOverride: v || undefined })}
            options={[{ value: '', label: "Use each episode's style" }, ...NARRATION_STYLES.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Visuals</h3>
        <Field label="Visual style" hint={VISUAL_STYLES.find((s) => s.id === value.visualStyle)?.description}>
          <SimpleSelect value={value.visualStyle} onValueChange={(v) => set({ visualStyle: v })} options={VISUAL_STYLES.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Video quality">
            <SimpleSelect value={value.resolution} onValueChange={(v) => set({ resolution: v as '720p' | '1080p' })} options={[{ value: '720p', label: '720p (native)' }, { value: '1080p', label: '1080p (upscaled)' }]} />
          </Field>
          <Field label="Provider">
            <SimpleSelect
              value={value.videoProvider}
              onValueChange={(v) => set({ videoProvider: v })}
              options={(providers.data?.providers ?? [{ id: value.videoProvider, label: value.videoProvider }]).map((p) => ({ value: p.id, label: p.label }))}
            />
          </Field>
        </div>
        <Field label="Video model" hint={caps ? `${caps.minClipSeconds}–${caps.maxClipSeconds}s clips · ${caps.aspectRatios.join(', ')} · ${caps.watermark}` : 'Leave empty to use the model configured in settings'}>
          <Input value={value.videoModel} onChange={(e) => set({ videoModel: e.target.value })} placeholder={providers.data?.selected.model || 'Auto (from settings)'} />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sound</h3>
        <Field label="Background music" hint="Only tracks you uploaded with confirmed commercial rights are listed.">
          <SimpleSelect
            value={value.musicTrackId ?? ''}
            onValueChange={(v) => set({ musicTrackId: v || undefined })}
            options={[{ value: '', label: 'No music' }, ...(music.data ?? []).filter((m) => m.kind !== 'sfx').map((m) => ({ value: m._id, label: `${m.title}${m.mood ? ` · ${m.mood}` : ''}` }))]}
          />
        </Field>
        <Field label={`Music volume · ${Math.round(value.musicVolume * 100)}%`}>
          <Slider min={0} max={1} step={0.01} value={[value.musicVolume]} onValueChange={([v]) => set({ musicVolume: v! })} />
        </Field>
        <Field label={`Sound-effect intensity · ${Math.round(value.sfxIntensity * 100)}%`} hint="Ambient audio from generated clips, kept under the narration.">
          <Slider min={0} max={1} step={0.01} value={[value.sfxIntensity]} onValueChange={([v]) => set({ sfxIntensity: v! })} />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subtitles</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Font">
            <Input value={value.subtitles.font} onChange={(e) => sub({ font: e.target.value })} />
          </Field>
          <Field label="Font size">
            <Input type="number" min={24} max={120} value={value.subtitles.fontSize} onChange={(e) => sub({ fontSize: Number(e.target.value) })} />
          </Field>
          <Field label="Text colour">
            <div className="flex gap-2">
              <input type="color" className="h-9 w-10 rounded border bg-transparent" value={value.subtitles.textColor} onChange={(e) => sub({ textColor: e.target.value.toUpperCase() })} />
              <Input value={value.subtitles.textColor} onChange={(e) => sub({ textColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Highlight colour">
            <div className="flex gap-2">
              <input type="color" className="h-9 w-10 rounded border bg-transparent" value={value.subtitles.highlightColor} onChange={(e) => sub({ highlightColor: e.target.value.toUpperCase() })} />
              <Input value={value.subtitles.highlightColor} onChange={(e) => sub({ highlightColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Animation">
            <SimpleSelect
              value={value.subtitles.animation}
              onValueChange={(v) => sub({ animation: v as VideoGenerationSettings['subtitles']['animation'] })}
              options={[{ value: 'none', label: 'None' }, { value: 'pop', label: 'Pop' }, { value: 'karaoke', label: 'Karaoke' }, { value: 'fade', label: 'Fade' }]}
            />
          </Field>
          <Field label={`Background · ${Math.round(value.subtitles.backgroundOpacity * 100)}%`}>
            <Slider min={0} max={1} step={0.05} value={[value.subtitles.backgroundOpacity]} onValueChange={([v]) => sub({ backgroundOpacity: v! })} />
          </Field>
        </div>
        <Field label={`Position from bottom · ${Math.round(value.subtitles.positionFromBottom * 100)}%`} hint="Keeps captions clear of Shorts/Reels UI at the bottom and right.">
          <Slider min={0.12} max={0.6} step={0.01} value={[value.subtitles.positionFromBottom]} onValueChange={([v]) => sub({ positionFromBottom: v! })} />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Batch</h3>
        <Field label={`Max concurrent episodes · ${concurrency}`}>
          <Slider min={1} max={5} step={1} value={[concurrency]} onValueChange={([v]) => onConcurrency(v!)} />
        </Field>
      </section>
    </div>
  );
}
