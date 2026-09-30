import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A screen's title with the line under it and, on the right, its action. A desktop puts the line beside the
// title, as the desktop frames do. New order's phone frame has the smaller title, the others the larger one.
export function PageHeader({ title, small = false, action, className, children }: { title: string; small?: boolean; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 lg:items-center">
      <div className="min-w-0 lg:flex lg:items-baseline lg:gap-3.5">
        <h1 className={cn('font-bold lg:font-heading lg:text-[26px] lg:leading-8', small ? 'text-[17px] leading-[23px]' : 'font-sans text-[22px] leading-[27px]')}>{title}</h1>
        {children && (
          <div className={cn('text-muted-foreground lg:mt-0 lg:text-[15px] lg:leading-5', small ? 'mt-[11px] text-[13px] leading-4' : 'mt-1.5 text-xs leading-[15px]', className)}>
            {children}
          </div>
        )}
      </div>
      {action}
    </header>
  );
}
