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
  return <div ref={ref} data-slot="input-otp-group" className={cn("flex items-center gap-2", className)} {...props} />
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
        // Elevated fill so the boxes read on every surface they sit on (the
        // setup dialog, the sign-in card, the Account settings card).
        "relative flex h-12 w-11 items-center justify-center rounded-lg bg-surface-elevated text-[20px] font-semibold tabular-nums text-white transition-[box-shadow,background-color] duration-150 outline-none",
        "data-[active=true]:z-10 data-[active=true]:ring-2 data-[active=true]:ring-teal-500",
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
