import type { SourceListItem } from '@/lib/types';
import { Progress } from '../ui/misc';

const ACTIVE = new Set(['extracting', 'extracted', 'chunking', 'embedding', 'analyzing']);

export function SourceProgress({ s }: { s: SourceListItem }) {
  const st = s.stats ?? { extractedPages: 0, ocrPages: 0, failedPages: 0, chunks: 0, embeddedChunks: 0 };
  return (
    <div className="min-w-[220px] space-y-1.5">
      {(ACTIVE.has(s.status) || (s.progress?.percent ?? 0) > 0) && s.status !== 'indexed' && s.status !== 'outlined' && (
        <>
          <Progress value={s.progress?.percent ?? 0} tone={s.status === 'failed' ? 'danger' : 'primary'} />
          <div className="text-[11px] text-muted-foreground">{s.progress?.message || s.progress?.stage || s.status}</div>
        </>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
        <span>
          {st.extractedPages}/{s.totalPages} pages
        </span>
        {st.ocrPages > 0 && <span className="text-info">{st.ocrPages} OCR</span>}
        {st.failedPages > 0 && <span className="text-destructive">{st.failedPages} failed</span>}
        <span>
          {st.embeddedChunks}/{st.chunks} chunks indexed
        </span>
      </div>
    </div>
  );
}
