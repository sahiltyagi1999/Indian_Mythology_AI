'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, UserRound, Users } from 'lucide-react';
import { useCharacters } from '@/lib/queries/misc';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { SourceSelect } from '@/components/source-select';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { CharacterEditor } from '@/components/characters/editor';
import { fileUrl } from '@/lib/utils';

function CharactersInner() {
  const params = useSearchParams();
  const [search, setSearch] = React.useState(params.get('search') ?? '');
  const [q, setQ] = React.useState(search);
  const [sourceId, setSourceId] = React.useState('');
  const [open, setOpen] = React.useState<string | 'new' | null>(null);
  const { data, isLoading, error, refetch } = useCharacters({ sourceId: sourceId || undefined, search: q || undefined });
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <PageHeader
        icon={Users}
        title="Character Library"
        description="Stable visual identities for every character, with age variants (young Arjuna, elderly Bhishma…). Identity prompts and reference images keep characters consistent across episodes. Edited characters are never overwritten by AI."
        actions={
          <>
            <SourceSelect allowAll value={sourceId} onChange={setSourceId} className="w-52" />
            <Button onClick={() => setOpen('new')}>
              <Plus /> New character
            </Button>
          </>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search name, Hindi name or alias" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-4" />}
      {isLoading ? (
        <LoadingRows />
      ) : !data?.length ? (
        <EmptyState icon={UserRound} title="No characters found" description="Characters are generated with the master outline, or you can add one manually." action={<Button onClick={() => setOpen('new')}><Plus /> New character</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.map((c) => {
            const img = c.variants.flatMap((v) => v.referenceImages)[0];
            const palette = c.variants[0]?.colorPalette ?? [];
            return (
              <button key={c._id} onClick={() => setOpen(c._id)} className="text-left">
                <Card className="flex h-full gap-4 p-4 transition-colors hover:border-primary/40">
                  <div className="h-24 w-[72px] shrink-0 overflow-hidden rounded-md border bg-surface-sunken">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(img)} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-b from-secondary/40 to-transparent font-hindi text-2xl text-secondary-foreground">{(c.nameHi || c.name).slice(0, 1)}</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      {c.nameHi && <span className="truncate font-hindi text-sm text-muted-foreground">{c.nameHi}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.role || c.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.variants.map((v) => (
                        <Badge key={v.key}>{v.label || v.key}</Badge>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex gap-0.5">
                        {palette.slice(0, 5).map((p, i) => (
                          <span key={i} className="h-3 w-3 rounded-sm border border-black/30" style={{ background: p }} title={p} />
                        ))}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{c.episodeCount} episodes</span>
                    </div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="max-w-3xl">
          <DialogTitle>{open === 'new' ? 'New character' : 'Edit character'}</DialogTitle>
          <DialogDescription>Profiles feed the scene planner and the video provider prompts.</DialogDescription>
          {open && <CharacterEditor id={open === 'new' ? null : open} sourceId={sourceId || undefined} onClose={() => setOpen(null)} />}
        </SheetContent>
      </Dialog>
    </>
  );
}

export default function CharactersPage() {
  return (
    <React.Suspense fallback={<LoadingRows />}>
      <CharactersInner />
    </React.Suspense>
  );
}
