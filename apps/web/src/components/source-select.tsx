'use client';
import * as React from 'react';
import { useSources } from '@/lib/queries/sources';
import { SimpleSelect } from './ui/select';

/** Source selector. With `allowAll`, '' means every source. Auto-selects the first source otherwise. */
export function SourceSelect({ value, onChange, allowAll, className }: { value: string; onChange: (v: string) => void; allowAll?: boolean; className?: string }) {
  const { data } = useSources();
  React.useEffect(() => {
    if (!allowAll && !value && data?.length) onChange(data[0]!._id);
  }, [allowAll, value, data, onChange]);
  return (
    <SimpleSelect
      className={className ?? 'w-64'}
      value={value}
      onValueChange={onChange}
      placeholder="Select a source"
      options={[...(allowAll ? [{ value: '', label: 'All sources' }] : []), ...(data ?? []).map((s) => ({ value: s._id, label: s.title }))]}
    />
  );
}
