import { Tabs } from "@base-ui/react/tabs"
import { cn } from "cn"

// The design's two-way switch (Open and Past): a grey track with the chosen side as a white pill. It is a set
// of tabs underneath, so the arrow keys move between the sides and each side owns a panel.
function Segmented({ className, ...props }: Tabs.Root.Props) {
  return (
    <Tabs.Root
      data-slot="segmented"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function SegmentedList({ className, ...props }: Tabs.List.Props) {
  return (
    <Tabs.List
      data-slot="segmented-list"
      className={cn(
        "grid auto-cols-fr grid-flow-col rounded-[10px] bg-foreground/5 p-1",
        className
      )}
      {...props}
    />
  )
}

function SegmentedItem({ className, ...props }: Tabs.Tab.Props) {
  return (
    <Tabs.Tab
      data-slot="segmented-item"
      className={cn(
        "h-[38px] rounded-[10px] px-3 text-xs whitespace-nowrap text-muted-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 data-active:bg-card data-active:font-semibold data-active:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SegmentedPanel({ className, ...props }: Tabs.Panel.Props) {
  return (
    <Tabs.Panel
      data-slot="segmented-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Segmented, SegmentedList, SegmentedItem, SegmentedPanel }
