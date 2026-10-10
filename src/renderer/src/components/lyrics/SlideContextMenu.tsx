import type { ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { ChevronRight } from '@/icons'
import { cn } from '@/lib/utils'
import type { LyricsSectionType } from '@shared/ipc'
import { SLIDE_LABEL_CHOICES, sectionColor } from '@/components/lyrics/section-colors'

/** The slide a right-click landed on, and the section it belongs to. */
export interface SlideMenuTarget {
  slide: number
  section: number
}

const PANEL =
  'z-50 min-w-48 overflow-hidden rounded-lg bg-popover p-1 text-[13px] text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-spring-in'
const ITEM =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-tertiary data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
const SEPARATOR = 'my-1 h-px bg-surface-border'
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890']

/**
 * Right-click on a slide, ProPresenter-style: go live, group, hot key, copy,
 * select, delete. Wraps the slide grid; the slide under the pointer is read
 * from its `data-lyric-slide` / `data-lyric-section` attributes on open, so a
 * right-click anywhere else opens nothing.
 */
export function SlideContextMenu({
  target,
  onTarget,
  disabled,
  hotkey,
  usedKeys,
  picked,
  onGoLive,
  onEdit,
  onQuickEdit,
  onGroup,
  onHotkey,
  onCopy,
  onSelect,
  onDelete,
  children,
}: {
  target: SlideMenuTarget | null
  onTarget: (target: SlideMenuTarget | null) => void
  /** No menu while dragging, painting or saving. */
  disabled: boolean
  /** The target section's current key. */
  hotkey: string | undefined
  /** Keys other sections of this song already use. */
  usedKeys: ReadonlySet<string>
  /** How many slides the Group / Delete actions will touch. */
  picked: number
  onGoLive: () => void
  onEdit: () => void
  /** Edit this slide's text on the card — offered for a single slide only. */
  onQuickEdit: () => void
  onGroup: (choice: { type: LyricsSectionType; label: string }) => void
  onHotkey: (key: string | undefined) => void
  onCopy: () => void
  onSelect: () => void
  onDelete: () => void
  children: ReactNode
}): React.ReactElement {
  const many = picked > 1
  return (
    <ContextMenu.Root onOpenChange={(open) => { if (!open) onTarget(null) }}>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(event) => {
          const el = (event.target as HTMLElement).closest<HTMLElement>('[data-lyric-slide]')
          const slide = Number(el?.dataset.lyricSlide)
          const section = Number(el?.dataset.lyricSection)
          // preventDefault here keeps Radix closed: not on a slide, or busy.
          if (disabled || !el || !Number.isInteger(slide) || !Number.isInteger(section)) {
            event.preventDefault()
            return
          }
          onTarget({ slide, section })
        }}
      >
        <div>{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        {target && (
          <ContextMenu.Content
            className={PANEL}
            collisionPadding={12}
            // Leave focus where the action put it (Quick Edit's text box),
            // not back on the grid — that would end the edit as it starts.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <ContextMenu.Item className={ITEM} onSelect={onGoLive}>Go live</ContextMenu.Item>
            {!many && <ContextMenu.Item className={ITEM} onSelect={onQuickEdit}>Quick Edit</ContextMenu.Item>}
            <ContextMenu.Item className={ITEM} onSelect={onEdit}>Edit song…</ContextMenu.Item>
            <ContextMenu.Separator className={SEPARATOR} />

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={cn(ITEM, 'data-[state=open]:bg-surface-tertiary')}>
                {many ? `Group ${picked} slides` : 'Group'}
                <ChevronRight size={12} className="ml-auto" aria-hidden="true" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={PANEL} sideOffset={4} collisionPadding={12}>
                  {SLIDE_LABEL_CHOICES.map((choice) => (
                    <ContextMenu.Item key={choice.label} className={ITEM} onSelect={() => onGroup(choice)}>
                      <span className="size-3.5 shrink-0 rounded-sm" style={{ background: sectionColor(choice.type) }} />
                      {choice.label}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={cn(ITEM, 'data-[state=open]:bg-surface-tertiary')}>
                Hot Key
                {hotkey && (
                  <span className="ml-auto rounded bg-[rgb(var(--hue-orange))] px-1.5 text-[11px] font-bold text-ink">{hotkey}</span>
                )}
                <ChevronRight size={12} className={hotkey ? '' : 'ml-auto'} aria-hidden="true" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={cn(PANEL, 'w-56')} sideOffset={4} collisionPadding={12}>
                  <p className="px-2 pb-1.5 pt-1 text-[11px] text-slate-500">
                    Press the key in the song view to put this section live.
                  </p>
                  <div className="grid grid-cols-6 gap-1 p-1">
                    {KEYS.map((key) => (
                      <ContextMenu.Item
                        key={key}
                        onSelect={() => onHotkey(key)}
                        title={usedKeys.has(key) ? `${key} is on another section — choosing it moves it here` : undefined}
                        className={cn(
                          'grid h-7 cursor-default place-items-center rounded-md text-[12px] font-semibold outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-white/40',
                          key === hotkey
                            ? 'bg-[rgb(var(--hue-orange))] text-ink'
                            : usedKeys.has(key)
                              ? 'bg-surface-secondary text-slate-500'
                              : 'bg-surface-tertiary text-slate-200',
                        )}
                      >
                        {key}
                      </ContextMenu.Item>
                    ))}
                  </div>
                  {hotkey && (
                    <>
                      <ContextMenu.Separator className={SEPARATOR} />
                      <ContextMenu.Item className={ITEM} onSelect={() => onHotkey(undefined)}>Remove hot key</ContextMenu.Item>
                    </>
                  )}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Separator className={SEPARATOR} />

            <ContextMenu.Item className={ITEM} onSelect={onCopy}>Copy text</ContextMenu.Item>
            <ContextMenu.Item className={ITEM} onSelect={onSelect}>Select</ContextMenu.Item>
            <ContextMenu.Separator className={SEPARATOR} />
            <ContextMenu.Item className={cn(ITEM, 'text-red-400')} onSelect={onDelete}>
              {many ? `Delete ${picked} slides` : 'Delete slide'}
            </ContextMenu.Item>
          </ContextMenu.Content>
        )}
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
