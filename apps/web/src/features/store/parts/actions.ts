import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The shared Button as the shop's frames draw it: a 10 px radius and semibold words. Orange is the one main
// action of a screen and goes grey when it is off, as in the style guide, also when it is kept focusable while off
// and says so with data-disabled rather than the disabled attribute. SENDING keeps an off orange button orange while
// what it sends is on its way. Plain is white with a thin line, and stays that way when the device is in dark mode,
// where the shared outline button would turn grey.
// Pass these to <Button className>, or use the link forms to dress a <Link> as a button.
export const ORANGE = 'rounded-[10px] border-0 font-semibold disabled:bg-border disabled:text-muted-foreground/65 disabled:opacity-100 data-disabled:bg-border data-disabled:text-muted-foreground/65 data-disabled:opacity-100 data-disabled:pointer-events-none';
export const SENDING = 'disabled:bg-primary disabled:text-primary-foreground data-disabled:bg-primary data-disabled:text-primary-foreground';
export const PLAIN = 'rounded-[10px] bg-card font-semibold dark:border-border dark:bg-card dark:hover:bg-muted';

export const orangeLink = (className: string) => cn(buttonVariants(), ORANGE, className);
export const plainLink = (className: string) => cn(buttonVariants({ variant: 'outline' }), PLAIN, className);
