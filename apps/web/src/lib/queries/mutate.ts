'use client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../api';

/**
 * Mutation with toast feedback and cache invalidation. Missing credentials surface with a settings hint.
 */
export function useAction<TVars = void, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult, v: TVars) => string | null);
    invalidate?: QueryKey[];
    onSuccess?: (r: TResult, v: TVars) => void;
    onError?: (e: unknown, v: TVars) => boolean | void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      const msg = typeof opts.success === 'function' ? opts.success(r, v) : opts.success;
      if (msg) toast.success(msg);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      opts.onSuccess?.(r, v);
    },
    onError: (e, v) => {
      if (opts.onError?.(e, v)) return;
      if (e instanceof ApiError && e.code === 'MISSING_CREDENTIALS') {
        toast.error(e.message, { action: { label: 'Settings', onClick: () => (window.location.href = '/settings') } });
      } else toast.error(errorMessage(e));
    },
  });
}
