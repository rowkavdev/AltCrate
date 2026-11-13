import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { cn } from "cn"

function Slider({
  className,
  value,
  defaultValue = [0],
  thumbLabels = [],
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  thumbLabels?: string[]
}) {
  const values = value ?? defaultValue
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          aria-label={thumbLabels[index]}
          className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-shadow outline-none hover:ring-3 hover:ring-ring/20 focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  )
}
export { Slider }
