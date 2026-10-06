import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { Minus } from '@/icons'

import { cn } from "@/lib/utils"

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}
>(function InputOTP({
  className,
  containerClassName,
  ...props
}, ref) {
  return (
    <OTPInput
      ref={ref}
      data-slot="input-otp"
      containerClassName={cn(
        "flex items-center gap-2 has-disabled:opacity-50",
        containerClassName
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
})

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentProps<"div">
>(function InputOTPGroup({ className, ...props }, ref) {
  return <div ref={ref} data-slot="input-otp-group" className={cn("flex items-center gap-1.5", className)} {...props} />
})

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentProps<"div"> & {
  index: number
}
>(function InputOTPSlot({
  index,
  className,
  ...props
}, ref) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      ref={ref}
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        "relative flex h-11 w-10 items-center justify-center rounded-lg bg-surface text-[17px] font-medium tabular-nums text-white transition-all outline-none",
        "data-[active=true]:border-teal-500 data-[active=true]:ring-2 data-[active=true]:ring-teal-500/30 data-[active=true]:z-10",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-white duration-1000" />
        </div>
      )}
    </div>
  )
})

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentProps<"div">
>(function InputOTPSeparator({ ...props }, ref) {
  return (
    <div ref={ref} data-slot="input-otp-separator" role="separator" {...props}>
      <Minus className="h-3.5 w-3.5 text-slate-600" />
    </div>
  )
})

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
