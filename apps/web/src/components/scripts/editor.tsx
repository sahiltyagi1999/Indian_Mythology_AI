'use client';
import * as React from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { countWords, estimateSpokenSeconds, NARRATION_STYLES, type SceneDescription } from '@mas/shared';
import type { EpisodeDetail } from '@/lib/types';
import { useEditEpisode } from '@/lib/queries/episodes';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Badge } from '../ui/badge';

type Ep = EpisodeDetail['episode'];

export function ScriptEditor({ ep, onDone }: { ep: Ep; onDone: () => void }) {
  const [title, setTitle] = React.useState(ep.title);
  const [hook, setHook] = React.useState(ep.hook);
  const [narration, setNarration] = React.useState(ep.narrationText);
  const [ending, setEnding] = React.useState(ep.ending);
  const [teaser, setTeaser] = React.useState(ep.nextEpisodeTeaser);
  const [style, setStyle] = React.useState(ep.styleOverride ?? '');
  const [scenes, setScenes] = React.useState<SceneDescription[]>(ep.sceneDescriptions ?? []);
  const [note, setNote] = React.useState('');
  const save = useEditEpisode(ep._id);

  const words = countWords(narration);
  const seconds = estimateSpokenSeconds(narration);
  const tone = Math.abs(seconds - 55) <= 5 ? 'success' : Math.abs(seconds - 55) <= 10 ? 'warning' : 'danger';

  const submit = () => {
    const body: Record<string, unknown> = {};
    if (title !== ep.title) body.title = title;
    if (hook !== ep.hook) body.hook = hook;
    if (narration !== ep.narrationText) body.narrationText = narration;
    if (ending !== ep.ending) body.ending = ending;
    if (teaser !== ep.nextEpisodeTeaser) body.nextEpisodeTeaser = teaser;
    if ((style || null) !== (ep.styleOverride ?? null)) body.styleOverride = style || null;
    if (JSON.stringify(scenes) !== JSON.stringify(ep.sceneDescriptions ?? [])) body.sceneDescriptions = scenes;
    if (!Object.keys(body).length) return onDone();
    if (note) body.changeNote = note;
    save.mutate(body, { onSuccess: onDone });
  };

  const updateScene = (i: number, patch: Partial<SceneDescription>) => setScenes((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-4">
      <Card className="border-primary/30">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Edit script</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <span className="tabular-nums text-muted-foreground">{words} words</span>
            <Badge tone={tone}>~{seconds}s spoken (target 55s)</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ep.status === 'approved' && (
            <p className="rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning">Saving changes to an approved script moves it back to Draft for re-approval and marks its existing narration audio as stale.</p>
          )}
          <Field label="Title">
            <Input className="font-hindi" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Hook (first 2–3 seconds; must start the narration)">
            <Textarea className="font-hindi" rows={2} value={hook} onChange={(e) => setHook(e.target.value)} />
          </Field>
          <Field label="Full narration" hint="Everything that will be spoken, from hook to teaser. Duration is re-measured from real audio during video production.">
            <Textarea className="min-h-[260px] font-hindi text-base leading-8" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Ending">
              <Textarea className="font-hindi" rows={2} value={ending} onChange={(e) => setEnding(e.target.value)} />
            </Field>
            <Field label="Next-episode teaser">
              <Textarea className="font-hindi" rows={2} value={teaser} onChange={(e) => setTeaser(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Narration style override">
              <SimpleSelect value={style} onValueChange={setStyle} options={[{ value: '', label: 'Use AI-selected style' }, ...NARRATION_STYLES.map((s) => ({ value: s.id, label: s.name }))]} />
            </Field>
            <Field label="Change note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why (saved in version history)" />
            </Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Scene descriptions ({scenes.length})</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={scenes.length >= 12}
            onClick={() => setScenes((s) => [...s, { sceneNumber: s.length + 1, narrationExcerpt: '', visual: '', characters: [], environment: '', emotion: '' }])}
          >
            <Plus /> Add scene
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {scenes.map((sc, i) => (
            <div key={i} className="grid gap-2 rounded-md border bg-surface-sunken/60 p-3 md:grid-cols-2">
              <div className="flex items-center justify-between md:col-span-2">
                <span className="text-xs font-semibold">Scene {i + 1}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Remove scene" onClick={() => setScenes((s) => s.filter((_, j) => j !== i).map((x, j) => ({ ...x, sceneNumber: j + 1 })))}>
                  <Trash2 />
                </Button>
              </div>
              <Field label="Narration excerpt" className="md:col-span-2">
                <Input className="font-hindi" value={sc.narrationExcerpt} onChange={(e) => updateScene(i, { narrationExcerpt: e.target.value })} />
              </Field>
              <Field label="Visual" className="md:col-span-2">
                <Textarea rows={2} value={sc.visual} onChange={(e) => updateScene(i, { visual: e.target.value })} />
              </Field>
              <Field label="Characters (comma separated)">
                <Input value={sc.characters.join(', ')} onChange={(e) => updateScene(i, { characters: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Environment">
                <Input value={sc.environment} onChange={(e) => updateScene(i, { environment: e.target.value })} />
              </Field>
              <Field label="Emotion">
                <Input value={sc.emotion} onChange={(e) => updateScene(i, { emotion: e.target.value })} />
              </Field>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-lg border bg-surface-raised/95 p-3 shadow-xl backdrop-blur">
        <Button variant="outline" onClick={onDone}>
          <X /> Cancel
        </Button>
        <Button onClick={submit} loading={save.isPending}>
          <Save /> Save as new version
        </Button>
      </div>
    </div>
  );
}
