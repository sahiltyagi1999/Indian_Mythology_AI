'use client';
import * as React from 'react';
import { Download, FileAudio, Captions, MoreHorizontal, Play, RefreshCcw, Trash2 } from 'lucide-react';
import type { VideoListItem } from '@/lib/types';
import { useDeleteVideo, useRegenerateVideo } from '@/lib/queries/video';
import { fileUrl } from '@/lib/utils';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ConfirmDialog } from '../ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';

export function VideoPlayerDialog({ video, open, onOpenChange }: { video: VideoListItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-4">
        <DialogHeader>
          <DialogTitle className="font-hindi">
            {video.episodeNumber}. {video.episodeTitle} · v{video.version}
          </DialogTitle>
        </DialogHeader>
        {video.videoPath ? (
          <video src={fileUrl(video.videoPath)} controls autoPlay playsInline className="aspect-[9/16] w-full rounded-md bg-black" poster={video.thumbnailPath ? fileUrl(video.thumbnailPath) : undefined} />
        ) : (
          <p className="text-sm text-muted-foreground">This version has no rendered file yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function downloadName(v: VideoListItem, ext: string) {
  return `episode-${v.episodeNumber}-v${v.version}.${ext}`;
}

export function VideoActions({ video, onDeleted }: { video: VideoListItem; onDeleted?: () => void }) {
  const [preview, setPreview] = React.useState(false);
  const [regen, setRegen] = React.useState(false);
  const [reuse, setReuse] = React.useState(true);
  const [del, setDel] = React.useState(false);
  const regenerate = useRegenerateVideo();
  const remove = useDeleteVideo();
  const done = video.status === 'completed';

  return (
    <>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" disabled={!video.videoPath} onClick={() => setPreview(true)} aria-label="Preview">
          <Play />
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={!video.videoPath} asChild={!!video.videoPath} aria-label="Download MP4">
          {video.videoPath ? (
            <a href={`${fileUrl(video.videoPath)}?download=${downloadName(video, 'mp4')}`}>
              <Download />
            </a>
          ) : (
            <span>
              <Download />
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Downloads</DropdownMenuLabel>
            <DropdownMenuItem disabled={!video.subtitlePaths?.srt} asChild>
              <a href={video.subtitlePaths?.srt ? `${fileUrl(video.subtitlePaths.srt)}?download=${downloadName(video, 'srt')}` : undefined}>
                <Captions /> Subtitles (SRT)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!video.subtitlePaths?.ass} asChild>
              <a href={video.subtitlePaths?.ass ? `${fileUrl(video.subtitlePaths.ass)}?download=${downloadName(video, 'ass')}` : undefined}>
                <Captions /> Subtitles (ASS)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!video.audioPath} asChild>
              <a href={video.audioPath ? `${fileUrl(video.audioPath)}?download=${downloadName(video, 'mp3')}` : undefined}>
                <FileAudio /> Narration audio
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setRegen(true)}>
              <RefreshCcw /> Regenerate as new version
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => setDel(true)}>
              <Trash2 /> Delete this version
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <VideoPlayerDialog video={video} open={preview} onOpenChange={setPreview} />
      <Dialog open={regen} onOpenChange={setRegen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate episode {video.episodeNumber}</DialogTitle>
            <DialogDescription>Creates version {video.version + 1}. The current version{done ? ' and its files' : ''} are kept — nothing is overwritten.</DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
            <Checkbox checked={reuse} onCheckedChange={(c) => setReuse(!!c)} className="mt-0.5" />
            <span>
              Reuse successful scene clips and narration
              <span className="block text-xs text-muted-foreground">Uncheck to generate new visuals (costs video credits again).</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegen(false)}>
              Cancel
            </Button>
            <Button loading={regenerate.isPending} onClick={() => regenerate.mutate({ id: video._id, reuseScenes: reuse }, { onSuccess: () => setRegen(false) })}>
              <RefreshCcw /> Create new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Delete version ${video.version}?`}
        description="The rendered MP4, subtitles and thumbnail for this version are removed. Other versions, cached narration and scene clips are kept."
        confirmLabel="Delete version"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(video._id, {
            onSuccess: () => {
              setDel(false);
              onDeleted?.();
            },
          })
        }
      />
    </>
  );
}
