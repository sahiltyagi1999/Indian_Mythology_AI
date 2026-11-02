'use client';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="This page doesn't exist or the record was deleted."
      action={
        <Button asChild>
          <Link href="/">Back to dashboard</Link>
        </Button>
      }
      className="mt-16"
    />
  );
}
