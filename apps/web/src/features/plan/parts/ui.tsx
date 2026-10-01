import type { ComponentProps, ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { cn } from '@/lib/utils';
import type { Tone } from './look';

// The small pieces the plan board's frames repeat: the column card, its heading, the figure chips, the pill
// switches and the "⋮" menu. Colours and type come from the tokens only.

// A column of the board, white on the page grey with the style guide's soft shadow.
export function Column({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('flex min-h-0 flex-col rounded-lg bg-card shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]', className)} {...props} />;
}

// A column's heading: the design's picture, the title and whatever sits on the right, which goes under the title
// when the two do not fit side by side.
export function ColumnHead({ icon, title, children, className }: { icon: string; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      <img src={icon} alt="" className="size-6 shrink-0 object-contain" />
      <h2 className="mr-auto text-[15px] leading-5 font-bold">{title}</h2>
      {children}
    </div>
  );
}

const FIGURE: Record<Tone, string> = { good: 'bg-good-tint text-good', warn: 'bg-warn-tint text-warn-ink', bad: 'bg-bad-tint text-bad' };

// A figure the API worked out, in its colour: "kg 88%", "fuel left 349 L".
export function Figure({ label, value, tone, small = false }: { label: string; value: string; tone: Tone; small?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-baseline rounded-full whitespace-nowrap', small ? 'gap-1 px-2 py-[3px] text-[9px] leading-3' : 'gap-1.5 px-2.5 py-[3px] text-[11px] leading-[15px]', FIGURE[tone])}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-bold">{value}</span>
    </span>
  );
}

// A small chip in the style guide's tones.
const CHIP: Record<Tone | 'plain' | 'ink', string> = { ...FIGURE, plain: 'bg-muted text-foreground', ink: 'bg-secondary text-secondary-foreground' };
export function Tag({ tone = 'plain', className, ...props }: ComponentProps<'span'> & { tone?: Tone | 'plain' | 'ink' }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-[3px] text-[11px] leading-[15px] font-semibold whitespace-nowrap', CHIP[tone], className)} {...props} />;
}

// Pills to pick one of: the chosen one is ink, the others white with a thin line.
export function Pills<T extends string>({ label, value, options, onChange, tight = false, className }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; tight?: boolean; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex shrink-0', tight ? 'gap-1' : 'gap-1.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-[26px] rounded-full text-[11px] font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            tight ? 'px-[7px]' : 'px-2.5',
            option.value === value ? 'bg-secondary text-secondary-foreground' : 'border bg-card text-foreground hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A menu from "⋮" or a name, in the style guide's popover look.
export function MenuRoot(props: Menu.Root.Props) {
  return <Menu.Root {...props} />;
}
export function MenuTrigger(props: Menu.Trigger.Props) {
  return <Menu.Trigger {...props} />;
}
// anchor places it at another element than its trigger, such as the drop area of the crew picker (spec 026).
export function MenuPopup({ className, align = 'end', anchor, children }: { className?: string; align?: 'start' | 'center' | 'end'; anchor?: Menu.Positioner.Props['anchor']; children: ReactNode }) {
  return (
    <Menu.Portal>
      <Menu.Positioner className="z-50 outline-none" sideOffset={6} align={align} anchor={anchor}>
        <Menu.Popup className={cn('max-h-[var(--available-height)] min-w-44 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none', className)}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
export function MenuItem({ className, ...props }: Omit<Menu.Item.Props, 'className'> & { className?: string }) {
  return (
    <Menu.Item
      className={cn('flex cursor-default items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none data-disabled:text-muted-foreground/65 data-highlighted:bg-muted', className)}
      {...props}
    />
  );
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Menu.GroupLabel className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">{children}</Menu.GroupLabel>;
}
export function MenuGroup(props: Menu.Group.Props) {
  return <Menu.Group {...props} />;
}
export function MenuSeparator() {
  return <Menu.Separator className="mx-1 my-1 h-px bg-border" />;
}
