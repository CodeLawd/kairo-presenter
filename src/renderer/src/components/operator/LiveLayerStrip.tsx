import { useAppStore } from '@/stores/useAppStore'
import { useState } from 'react'
import {
  AlignCenter,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Music2,
  Video,
  X,
  type Icon,
} from '@/icons'
import { cn } from '@/lib/utils'
import { clearLiveAll, clearLiveText } from '@/lib/clear-live-output'
import { useProgramState } from '@/hooks/useProgramState'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'

interface Layer {
  id: string
  label: string
  icon: Icon
  /** Something is on this layer right now. */
  on: boolean
  clear: () => Promise<unknown>
}

/**
 * One button per thing that can be on screen, under the live preview — the
 * ProPresenter clear group, laid out as a row so the slide keeps the full width. A lit button has content; clicking it takes
 * down that layer and nothing else. The top button clears them all.
 */
export function LiveLayerStrip({
  hasText,
  hasBackground,
}: {
  hasText: boolean
  hasBackground: boolean
}): React.ReactElement {
  const program = useProgramState()
  const trackLive = useTracksPlaybackStore((state) => state.library.liveId !== null)
  const [busy, setBusy] = useState(false)

  const layers: Layer[] = [
    {
      id: 'audio',
      label: 'Audio',
      icon: Music2,
      on: trackLive,
      clear: () => window.api.tracks.stop(),
    },
    {
      id: 'messages',
      label: 'Messages',
      icon: MessageSquare,
      on: program.message !== null,
      clear: () => window.api.program.clearMessage(),
    },
    {
      id: 'props',
      label: 'Props',
      icon: Layers,
      on: program.activePropIds.length > 0 || program.logo,
      clear: async () => {
        await window.api.program.clearProps()
        if (program.logo) await window.api.program.setLogo(false)
      },
    },
    {
      id: 'slide',
      label: 'Slide text',
      icon: AlignCenter,
      on: hasText,
      clear: () => clearLiveText(),
    },
    {
      id: 'background',
      label: 'Background',
      icon: ImageIcon,
      on: hasBackground,
      clear: async () => {
        await window.api.media.clear()
        useAppStore.setState({ liveDocumentPreview: null })
      },
    },
    {
      id: 'camera',
      label: 'Video',
      icon: Video,
      on: program.camera !== null,
      clear: () => window.api.program.setCamera(null),
    },
  ]
  const anything = layers.some((layer) => layer.on)

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = async (): Promise<void> => {
    // Text + background together (keeps the preview in step), then the rest.
    await clearLiveAll()
    await Promise.all(layers.filter((l) => l.on && l.id !== 'slide' && l.id !== 'background').map((l) => l.clear()))
  }

  return (
    // A segmented bar under the monitor, in its dark zinc so the two read as one
    // unit: one cell per layer split by a faint line, clear-all set apart on the
    // left by a firmer one, and a single faint border round the whole bar.
    <div
      role="group"
      aria-label="Clear layers"
      className="relative flex h-9 shrink-0 bg-zinc-900 after:pointer-events-none after:absolute after:inset-0 after:rounded-b-md after:ring-1 after:ring-inset after:ring-white/[0.08]"
    >
      <StripButton
        label="Clear all"
        icon={X}
        on={anything}
        danger
        disabled={!anything || busy}
        onClick={() => void run(clearAll)}
      />
      {/* Everything right of the line takes down one layer; left of it, all of them. */}
      <span className="w-px shrink-0 bg-zinc-700" aria-hidden="true" />
      {layers.map((layer, index) => (
        <StripButton
          key={layer.id}
          label={layer.on ? `Clear ${layer.label.toLowerCase()}` : layer.label}
          icon={layer.icon}
          on={layer.on}
          divided={index > 0}
          disabled={!layer.on || busy}
          onClick={() => void run(layer.clear)}
        />
      ))}
    </div>
  )
}

function StripButton({
  label,
  icon: Icon,
  on,
  danger = false,
  divided = false,
  disabled,
  onClick,
}: {
  label: string
  icon: Icon
  on: boolean
  danger?: boolean
  /** A faint line on the left, between this cell and the one before it. */
  divided?: boolean
  disabled: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    // The tooltip lives on the wrapper: a disabled button never fires the
    // pointer events that would show it, and a dim icon needs its name most.
    <div
      className={cn('flex h-full min-w-0 flex-1', divided && 'border-l border-zinc-800')}
      data-tooltip={label}
      data-tooltip-side="bottom"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'grid h-full w-full place-items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400',
          // A layer with something on it lifts a step with a blue icon; hover
          // turns it red, since clicking takes it down. Empty layers stay dim.
          on
            ? danger
              ? 'bg-tint-red text-red-300 hover:bg-red-900/70 hover:text-red-100'
              : 'bg-zinc-800 text-teal-300 hover:bg-tint-red hover:text-red-300'
            : 'text-zinc-600',
          disabled ? 'cursor-default' : 'cursor-pointer',
        )}
      >
        <Icon size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
