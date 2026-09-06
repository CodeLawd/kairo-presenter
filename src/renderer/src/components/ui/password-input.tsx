import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from '@/icons'
import { cn } from '@/lib/utils'

/**
 * A password field with a reveal toggle.
 *
 * Worth having everywhere: these are typed on a booth machine, often from a
 * phone screen in a dark room, and a typo in a hidden field is invisible until
 * it fails. The toggle starts hidden, so nothing is exposed to the room by
 * default.
 */
const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('input pr-10', className)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-200 focus-visible:text-slate-200 focus-visible:outline-none"
          aria-label={visible ? 'Hide password' : 'Show password'}
          // Never a tab stop between the field and the submit button: the
          // toggle is for the mouse, and tabbing into it interrupts typing.
          tabIndex={-1}
        >
          {visible ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      </div>
    )
  },
)

export default PasswordInput
