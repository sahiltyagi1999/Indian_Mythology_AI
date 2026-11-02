'use client';
import * as React from 'react';
import * as AD from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

/** Confirmation dialog for destructive or expensive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-surface-raised p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <AD.Title className="text-base font-semibold">{title}</AD.Title>
          {description && <AD.Description className="text-sm text-muted-foreground">{description}</AD.Description>}
          {children}
          <div className="flex justify-end gap-2">
            <AD.Cancel className={buttonVariants({ variant: 'outline' })}>Cancel</AD.Cancel>
            <button
              className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {loading ? 'Working…' : confirmLabel}
            </button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
