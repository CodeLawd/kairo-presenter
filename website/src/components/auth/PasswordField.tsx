'use client'

import { useId, useState } from 'react'
import { input, label as labelClass } from '@/components/auth/styles'

function IconEye(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

function IconEyeOff(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5" />
      <path d="M9.4 5.3A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a16.7 16.7 0 0 1-3.2 4.1" />
      <path d="M6.2 6.2A16.4 16.4 0 0 0 2.5 12S6 19 12 19a10 10 0 0 0 4.1-.9" />
    </svg>
  )
}

/**
 * Password input with a show/hide control. Keeps the toggle state local so
 * every auth form does not reimplement the same eye-button markup.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
  required,
  labelAccessory,
}: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  placeholder?: string
  minLength?: number
  required?: boolean
  /** e.g. "Forgot password" — sits on the same row as the label. */
  labelAccessory?: React.ReactNode
}): React.ReactElement {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className={labelClass} htmlFor={fieldId}>
          {label}
        </label>
        {labelAccessory}
      </div>
      <div className="relative">
        <input
          id={fieldId}
          className={`${input} pr-11`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:text-paper focus-visible:text-paper focus-visible:outline-none [&_svg]:h-[17px] [&_svg]:w-[17px]"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </div>
  )
}
