import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The style guide's status chip: a light tint with its own ink, fully round, never a stroke. The tones carry
// the same meaning on every screen: green done, yellow waiting, red a problem, blue a vehicle need.
const chipVariants = cva(
  "inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        good: "bg-good-tint text-good",
        warn: "bg-warn-tint text-warn-ink",
        bad: "bg-bad-tint text-bad",
        info: "bg-info-tint text-info",
        quiet: "bg-muted text-muted-foreground",
        plain: "bg-muted text-foreground",
      },
      size: {
        default: "px-2.5 py-[5px] text-xs leading-[15px]",
        sm: "px-2 py-1 text-[11px] leading-[14px]",
      },
    },
    defaultVariants: {
      tone: "quiet",
      size: "default",
    },
  }
)

function Chip({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return (
    <span
      data-slot="chip"
      className={cn(chipVariants({ tone, size, className }))}
      {...props}
    />
  )
}

export { Chip }
