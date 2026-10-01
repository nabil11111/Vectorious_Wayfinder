import { cn } from '@/lib/utils';

// The one orange action (frames 53:6373 and 53:6276). It stays off, in the style guide's grey, until there is a staff
// ID and four digits (rule 2). While the details are being checked it keeps its orange and says "Signing in…", and a
// second press sends nothing.
export function SignInButton({ ready, checking, className }: { ready: boolean; checking: boolean; className?: string }) {
  return (
    <button type="submit" disabled={!ready} aria-disabled={checking || undefined} className={cn('block h-12 w-full rounded-[9px] bg-primary text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-border disabled:text-muted-foreground aria-disabled:hover:bg-primary', className)}>
      {checking ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
