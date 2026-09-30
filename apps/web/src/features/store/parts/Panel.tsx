import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// The design draws its cards two ways: with a soft shadow on Today and New order, with a thin line on Orders,
// Orders placed and Help. Both are white with a 12 px radius and nothing else.
export function Panel({ line = false, className, ...props }: ComponentProps<'div'> & { line?: boolean }) {
  return (
    <div
      className={cn('rounded-lg bg-card', line ? 'border p-[15px]' : 'p-4 shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]', className)}
      {...props}
    />
  );
}
