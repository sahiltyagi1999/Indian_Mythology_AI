import { Film } from 'lucide-react';
import { cn, fileUrl } from '@/lib/utils';

export function VideoThumb({ path, className, alt = '' }: { path?: string | null; className?: string; alt?: string }) {
  return (
    <div className={cn('relative aspect-[9/16] overflow-hidden rounded-md border bg-surface-sunken', className)}>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(path)} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Film className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}
