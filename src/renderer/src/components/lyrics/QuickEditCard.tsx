import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { X } from '@/icons'

/**
 * A slide card turned into a text box (right-click → Quick Edit): edit the
 * lines in place without opening the song editor. ⌘↵, the × or clicking away
 * saves; Esc cancels; Return adds a line; a blank line starts another slide.
 */
export function QuickEditCard({
  initialText,
  slideNo,
  scale,
  barStyle,
  onSave,
  onCancel,
}: {
  initialText: string
  slideNo: number
  scale: number
  /** The section's colour bar style, so the card still reads as its section. */
  barStyle: CSSProperties
  onSave: (text: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [text, setText] = useState(initialText)
  const done = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // A frame later: the right-click menu that opened this is still closing.
    const frame = requestAnimationFrame(() => {
      const field = ref.current
      if (!field) return
      field.focus()
      field.setSelectionRange(field.value.length, field.value.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && text !== initialText) onSave(text)
    else onCancel()
  }

  return (
    <div className="relative w-full rounded-md border-2 border-white" data-no-marquee>
      <div className="overflow-hidden rounded-[4px]">
        <div className="relative aspect-video bg-black">
          <button
            type="button"
            // Before the text box loses focus, so this is one save, not two.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => finish(true)}
            aria-label="Close and save"
            title="Close and save"
            className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X size={13} aria-hidden="true" />
          </button>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              // Keep Esc / arrows / hotkeys from reaching the song view.
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); finish(false) }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true) }
            }}
            spellCheck={false}
            aria-label={`Edit slide ${slideNo}`}
            className="absolute inset-0 h-full w-full resize-none bg-transparent px-8 py-3 text-center font-semibold leading-snug tracking-wide text-white outline-none"
            style={{ fontSize: `${12 * scale}px` }}
          />
        </div>
        <div
          className="flex items-center gap-2 px-2"
          style={{ ...barStyle, height: `${Math.round(22 * scale)}px`, fontSize: `${Math.round(11 * scale)}px` }}
        >
          <span className="min-w-0 flex-1 truncate opacity-90">⌘↵ save · Esc cancel</span>
          <span className="shrink-0 tabular-nums">{slideNo}</span>
        </div>
      </div>
    </div>
  )
}
