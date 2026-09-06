import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface SecretKeyFieldProps {
  label?: string
  configured: boolean
  placeholder?: string
  /** Called when the user finishes typing a replacement (parent owns Save). */
  draft: string
  onDraftChange: (value: string) => void
  /** Enter replace mode / clear draft when cancelling replace. */
  onReplace: () => void
  onCancelReplace: () => void
  onRemove: () => void
  replacing: boolean
  className?: string
  name?: string
  'aria-label'?: string
  /** Optional hint under the saved row (e.g. org sync). */
  savedHint?: string
}

/**
 * Write-only secret control: once a key is saved, the real value is never shown
 * or copyable — a fixed mask + Replace / Remove only.
 */
export function SecretKeyField({
  configured,
  placeholder,
  draft,
  onDraftChange,
  onReplace,
  onCancelReplace,
  onRemove,
  replacing,
  className,
  name,
  'aria-label': ariaLabel,
  savedHint,
}: SecretKeyFieldProps): React.JSX.Element {
  const showInput = !configured || replacing

  if (!showInput) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <div
          className="flex items-center gap-2 rounded-lg border border-surface-border/60 bg-surface-secondary/40 px-3 py-2"
        >
          <p
            className="min-w-0 flex-1 select-none font-mono text-sm tracking-wider text-slate-300"
            aria-label={ariaLabel ? `${ariaLabel} saved` : 'API key saved'}
            // Fixed mask — not derived from the real key, so length leaks nothing.
          >
            ••••••••••••••••••••••••••••
          </p>
          <button
            type="button"
            className="btn-secondary py-1 px-2.5 text-xs font-semibold"
            onClick={onReplace}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn-secondary py-1 px-2.5 text-xs font-semibold text-rose-300 hover:text-rose-200"
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
        {savedHint ? (
          <p className="text-[10px] text-slate-500 leading-relaxed">{savedHint}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        type="password"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        placeholder={placeholder}
        className="input font-mono text-sm select-none"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        name={name}
      />
      {configured && replacing && (
        <button
          type="button"
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-300"
          onClick={onCancelReplace}
        >
          Cancel
        </button>
      )}
    </div>
  )
}

/** Local replace-mode helper for a single secret field. */
export function useSecretDraft(configured: boolean): {
  draft: string
  setDraft: (value: string) => void
  replacing: boolean
  beginReplace: () => void
  cancelReplace: () => void
  /** Value to send on save: undefined = unchanged, string = set. */
  takeSaveValue: () => string | undefined
  markSaved: () => void
} {
  const [draft, setDraft] = useState('')
  const [replacing, setReplacing] = useState(false)

  return {
    draft,
    setDraft,
    replacing,
    beginReplace: () => {
      setDraft('')
      setReplacing(true)
    },
    cancelReplace: () => {
      setDraft('')
      setReplacing(false)
    },
    takeSaveValue: () => {
      if (!configured || replacing) {
        const trimmed = draft.trim()
        return trimmed || undefined
      }
      return undefined
    },
    markSaved: () => {
      setDraft('')
      setReplacing(false)
    },
  }
}
