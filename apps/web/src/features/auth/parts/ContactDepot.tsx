import { cn } from '@/lib/utils';
import { CONTACT_LINE } from '../words';

// "Can't sign in? Contact your depot" (frames 53:6373 and 53:6276). The design gives no number to call, so pressing
// it opens a line under it that says who can help (spec 018, AC-11). On a desktop the line hangs below without
// moving the form, which sits in the middle of its side.
export function ContactDepot({ open, onPress, className }: { open: boolean; onPress: () => void; className?: string }) {
  return (
    <div className={cn('relative text-center text-xs leading-[17px] text-muted-foreground', className)}>
      <p>
        Can’t sign in?{' '}
        <button type="button" aria-expanded={open} aria-controls="contact-line" onClick={onPress} className="relative rounded-[4px] font-semibold text-foreground outline-none after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          Contact your depot
        </button>
      </p>
      <p id="contact-line" role="status" className="mt-2 empty:mt-0 lg:absolute lg:inset-x-0 lg:top-full">
        {open && CONTACT_LINE}
      </p>
    </div>
  );
}
