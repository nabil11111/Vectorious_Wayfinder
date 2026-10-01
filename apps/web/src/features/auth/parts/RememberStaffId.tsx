import { cn } from '@/lib/utils';

// Remember my staff ID (component "Login · remember staff ID"): a 22 px box in a 44 px row, off at first. The words
// under it say the PIN is still asked for.
export function RememberStaffId({ checked, onChange, className }: { checked: boolean; onChange: (checked: boolean) => void; className?: string }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-2.5', className)}>
      <span className="relative mt-px flex size-[22px] shrink-0">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-labelledby="remember-label" aria-describedby="remember-hint" className="peer size-full cursor-pointer appearance-none rounded-[4px] border border-mute bg-card outline-none transition-colors checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50" />
        <svg viewBox="0 0 22 22" aria-hidden="true" className="pointer-events-none absolute inset-0 hidden size-full text-primary-foreground peer-checked:block">
          <path d="M5 11L9 15L17 7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>
        <span id="remember-label" className="block text-[13px] leading-[18px] text-foreground">Remember my staff ID</span>
        <span id="remember-hint" className="mt-1 block text-[11px] leading-[15px] text-muted-foreground">You’ll still enter your PIN.</span>
      </span>
    </label>
  );
}
