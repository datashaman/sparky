import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown } from "lucide-react"

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  min?: number
  max?: number
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, min, max, disabled, onChange, value, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null)

    function setRef(el: HTMLInputElement | null) {
      inputRef.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
    }

    function step(delta: number) {
      const el = inputRef.current
      if (!el || disabled) return
      const current = el.value === "" ? 0 : parseInt(el.value, 10)
      const next = current + delta
      if (min != null && next < min) return
      if (max != null && next > max) return
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set
      nativeInputValueSetter?.call(el, String(next))
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }

    return (
      <div className="relative flex items-center">
        <input
          type="number"
          ref={setRef}
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={onChange}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-8 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
            className
          )}
          {...props}
        />
        <div className="absolute right-0 top-0 bottom-0 flex flex-col border-l border-input rounded-r-md overflow-hidden">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => step(1)}
            className="flex-1 flex items-center justify-center px-1.5 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <div className="h-px bg-input" />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => step(-1)}
            className="flex-1 flex items-center justify-center px-1.5 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }
)
NumberInput.displayName = "NumberInput"

export { NumberInput }
