'use client';
import * as React from 'react';
import Link from 'next/link';
import { ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import type { CharacterDTO } from '@mas/shared';
import { useCharacter, useDeleteCharacter, useRemoveReference, useSaveCharacter, useUploadReference } from '@/lib/queries/misc';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Field } from '../ui/label';
import { Badge } from '../ui/badge';
import { ConfirmDialog } from '../ui/alert-dialog';
import { LoadingRows } from '../common';
import { fileUrl } from '@/lib/utils';

type Variant = CharacterDTO['variants'][number];

const emptyVariant = (): Variant => ({
  key: 'adult',
  label: '',
  ageRange: '',
  facialFeatures: '',
  hair: '',
  clothing: '',
  armorAndAccessories: '',
  bodyType: '',
  colorPalette: [],
  identityPrompt: '',
  referenceImages: [],
});

interface Draft {
  name: string;
  nameHi: string;
  aliases: string;
  role: string;
  description: string;
  variants: Variant[];
}

function toDraft(c?: Partial<CharacterDTO>): Draft {
  return { name: c?.name ?? '', nameHi: c?.nameHi ?? '', aliases: (c?.aliases ?? []).join(', '), role: c?.role ?? '', description: c?.description ?? '', variants: c?.variants?.length ? c.variants : [emptyVariant()] };
}

export function CharacterEditor({ id, sourceId, onClose }: { id: string | null; sourceId?: string; onClose: () => void }) {
  const detail = useCharacter(id);
  const [d, setD] = React.useState<Draft>(toDraft());
  const save = useSaveCharacter();
  const remove = useDeleteCharacter();
  const uploadRef = useUploadReference();
  const removeRef = useRemoveReference();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (!id) setD(toDraft());
    else if (detail.data) setD(toDraft(detail.data.character));
  }, [id, detail.data]);

  if (id && detail.isLoading) return <LoadingRows rows={8} />;
  const setV = (i: number, p: Partial<Variant>) => setD((x) => ({ ...x, variants: x.variants.map((v, j) => (j === i ? { ...v, ...p } : v)) }));

  const submit = () => {
    const body = {
      name: d.name.trim(),
      nameHi: d.nameHi || undefined,
      aliases: d.aliases.split(',').map((a) => a.trim()).filter(Boolean),
      role: d.role,
      description: d.description,
      variants: d.variants.map((v) => ({ ...v, key: v.key.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'default', label: v.label || v.key })),
      ...(id ? {} : sourceId ? { sourceId } : {}),
    };
    save.mutate({ id: id ?? undefined, body }, { onSuccess: () => !id && onClose() });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name (canonical English)">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <Field label="Hindi name">
          <Input className="font-hindi" value={d.nameHi} onChange={(e) => setD({ ...d, nameHi: e.target.value })} />
        </Field>
        <Field label="Aliases (comma separated)" className="sm:col-span-2">
          <Input value={d.aliases} onChange={(e) => setD({ ...d, aliases: e.target.value })} />
        </Field>
        <Field label="Role" className="sm:col-span-2">
          <Input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Visual identity variants</h3>
          <Button size="sm" variant="outline" disabled={d.variants.length >= 6} onClick={() => setD({ ...d, variants: [...d.variants, { ...emptyVariant(), key: `variant-${d.variants.length + 1}` }] })}>
            <Plus /> Add age/look variant
          </Button>
        </div>
        {d.variants.map((v, i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-surface-sunken/60 p-4">
            <div className="flex items-center gap-2">
              <Input className="h-8 w-36" value={v.key} onChange={(e) => setV(i, { key: e.target.value })} placeholder="key (e.g. young)" />
              <Input className="h-8 flex-1" value={v.label} onChange={(e) => setV(i, { label: e.target.value })} placeholder="Label (e.g. Young Arjuna)" />
              <Button size="icon-sm" variant="ghost" aria-label="Remove variant" disabled={d.variants.length <= 1} onClick={() => setD({ ...d, variants: d.variants.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Age range">
                <Input value={v.ageRange} onChange={(e) => setV(i, { ageRange: e.target.value })} />
              </Field>
              <Field label="Body type">
                <Input value={v.bodyType} onChange={(e) => setV(i, { bodyType: e.target.value })} />
              </Field>
              <Field label="Facial features">
                <Textarea rows={2} value={v.facialFeatures} onChange={(e) => setV(i, { facialFeatures: e.target.value })} />
              </Field>
              <Field label="Hair">
                <Textarea rows={2} value={v.hair} onChange={(e) => setV(i, { hair: e.target.value })} />
              </Field>
              <Field label="Clothing">
                <Textarea rows={2} value={v.clothing} onChange={(e) => setV(i, { clothing: e.target.value })} />
              </Field>
              <Field label="Armour & accessories">
                <Textarea rows={2} value={v.armorAndAccessories} onChange={(e) => setV(i, { armorAndAccessories: e.target.value })} />
              </Field>
            </div>
            <Field label="Colour palette">
              <div className="flex flex-wrap items-center gap-2">
                {v.colorPalette.map((c, k) => (
                  <span key={k} className="flex items-center gap-1 rounded border px-1.5 py-1">
                    <input type="color" className="h-5 w-6 bg-transparent" value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888'} onChange={(e) => setV(i, { colorPalette: v.colorPalette.map((x, n) => (n === k ? e.target.value.toUpperCase() : x)) })} />
                    <span className="font-mono text-[10px] text-muted-foreground">{c}</span>
                    <button aria-label="Remove colour" onClick={() => setV(i, { colorPalette: v.colorPalette.filter((_, n) => n !== k) })}>
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </span>
                ))}
                {v.colorPalette.length < 8 && (
                  <Button size="sm" variant="ghost" onClick={() => setV(i, { colorPalette: [...v.colorPalette, '#E8A33D'] })}>
                    <Plus /> Colour
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Identity prompt" hint="Reused verbatim in every scene prompt featuring this character — keep it visual and stable.">
              <Textarea rows={3} value={v.identityPrompt} onChange={(e) => setV(i, { identityPrompt: e.target.value })} />
            </Field>
            {id && (
              <Field label={`Reference images (${v.referenceImages.length}/6)`} hint="Sent to video providers that support reference images, for consistent faces and costumes. Save new variants before uploading.">
                <div className="flex flex-wrap gap-2">
                  {v.referenceImages.map((key) => (
                    <div key={key} className="group relative h-24 w-20 overflow-hidden rounded border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(key)} alt="" className="h-full w-full object-cover" />
                      <button
                        className="absolute right-1 top-1 hidden rounded bg-black/70 p-0.5 group-hover:block"
                        aria-label="Remove image"
                        onClick={() => removeRef.mutate({ id, variant: v.key, key })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {v.referenceImages.length < 6 && (
                    <label className="flex h-24 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed text-[10px] text-muted-foreground hover:border-primary/50">
                      <ImagePlus className="h-4 w-4" /> {uploadRef.isPending ? 'Uploading' : 'Add'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadRef.mutate({ id, variant: v.key, file: f });
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </Field>
            )}
          </div>
        ))}
      </div>

      {id && detail.data?.episodes.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Appears in {detail.data.episodes.length} episodes</h3>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
            {detail.data.episodes.map((e) => (
              <Link key={e._id} href={`/scripts/${e._id}`}>
                <Badge className="hover:border-primary/40">
                  <span className="tabular-nums">{e.episodeNumber}</span> <span className="font-hindi">{e.title}</span>
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-6 flex justify-between gap-2 border-t bg-surface-raised px-6 py-3">
        {id ? (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!d.name.trim()}>
            <Save /> {id ? 'Save changes' : 'Create character'}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${d.name}?`}
        description="The character profile and its reference images are removed. Episodes that mention this character are not changed."
        confirmLabel="Delete character"
        destructive
        loading={remove.isPending}
        onConfirm={() => id && remove.mutate(id, { onSuccess: onClose })}
      />
    </div>
  );
}
