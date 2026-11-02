'use client';
import * as React from 'react';
import Link from 'next/link';
import { FileUp } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useReplaceSourceFile, useUploadSource } from '@/lib/queries/sources';
import { formatBytes } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { SimpleSelect } from '../ui/select';
import { Progress } from '../ui/misc';

function FilePicker({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [drag, setDrag] = React.useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${drag ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
    >
      <FileUp className="h-6 w-6 text-primary" />
      {file ? (
        <div className="text-sm">
          <div className="font-medium">{file.name}</div>
          <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Drop a PDF here or click to browse</div>
      )}
      <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

export function UploadSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState('');
  const [edition, setEdition] = React.useState('');
  const [language, setLanguage] = React.useState('hi');
  const [ocrMode, setOcrMode] = React.useState('auto');
  const [progress, setProgress] = React.useState(0);
  const [duplicateId, setDuplicateId] = React.useState<string | null>(null);
  const upload = useUploadSource();

  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setTitle('');
      setEdition('');
      setProgress(0);
      setDuplicateId(null);
    }
  }, [open]);

  const submit = () => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    if (edition) form.append('edition', edition);
    form.append('language', language);
    form.append('ocrMode', ocrMode);
    setDuplicateId(null);
    upload.mutate(
      { form, onProgress: setProgress },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) setDuplicateId((e.details as { sourceId?: string })?.sourceId ?? null);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a Mahabharata source</DialogTitle>
          <DialogDescription>Text PDFs are extracted page by page; scanned pages or broken Hindi font encodings fall back to OCR automatically.</DialogDescription>
        </DialogHeader>
        <FilePicker file={file} onFile={setFile} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to PDF title or file name" />
          </Field>
          <Field label="Edition" hint="Used to keep scripts faithful to one source edition" className="sm:col-span-2">
            <Input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="e.g. Gita Press, Gorakhpur (6 volumes)" />
          </Field>
          <Field label="PDF language" hint="Scripts are always written in Hindi (with a Hinglish copy). English is auto-detected.">
            <SimpleSelect value={language} onValueChange={setLanguage} options={[{ value: 'hi', label: 'Hindi' }, { value: 'en', label: 'English' }, { value: 'sa', label: 'Sanskrit' }]} />
          </Field>
          <Field label="OCR">
            <SimpleSelect
              value={ocrMode}
              onValueChange={setOcrMode}
              options={[
                { value: 'auto', label: 'Auto (only bad pages)' },
                { value: 'always', label: 'Always OCR' },
                { value: 'never', label: 'Never OCR' },
              ]}
            />
          </Field>
        </div>
        {upload.isPending && (
          <div className="space-y-1">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
          </div>
        )}
        {duplicateId && (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            This exact PDF is already uploaded.{' '}
            <Link className="underline" href={`/sources/${duplicateId}`} onClick={() => onOpenChange(false)}>
              Open the existing source
            </Link>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!file} loading={upload.isPending}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReplaceFileDialog({ sourceId, open, onOpenChange }: { sourceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState(0);
  const replace = useReplaceSourceFile(sourceId);
  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setProgress(0);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace PDF</DialogTitle>
          <DialogDescription>Only possible before episodes exist. Extracted text, chunks, vectors and outlines for this source are discarded.</DialogDescription>
        </DialogHeader>
        <FilePicker file={file} onFile={setFile} />
        {replace.isPending && <Progress value={progress} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file}
            loading={replace.isPending}
            onClick={() => {
              const form = new FormData();
              form.append('file', file!);
              replace.mutate({ form, onProgress: setProgress }, { onSuccess: () => onOpenChange(false) });
            }}
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
