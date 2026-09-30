import * as React from "react"
import { cn } from "cn"

// The style guide's loading block: grey for text and icons, a lighter grey for chips and buttons, no spinner
// and no movement. A block keeps the size of what it stands for, so the size comes in through className.
function Skeleton({
  className,
  soft = false,
  ...props
}: React.ComponentProps<"div"> & { soft?: boolean }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md", soft ? "bg-border/60" : "bg-border", className)}
      {...props}
    />
  )
}

export { Skeleton }
