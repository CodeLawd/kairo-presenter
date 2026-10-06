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
 * One button per thing that can be on screen, beside the live preview — the
 * ProPresenter clear-group column. A lit button has content; clicking it takes
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
      label: 'Props & logo',
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
      clear: () => window.api.media.clear(),
    },
    {
      id: 'camera',
      label: 'Camera',
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
    // Absolutely filled, so the column matches the preview's height instead of
    // stretching the whole live panel (which left a dark band under the picker).
    <div className="relative w-10 shrink-0 bg-surface-secondary">
      <div className="absolute inset-0 flex flex-col gap-1 overflow-hidden p-1" aria-label="Clear layers">
        <StripButton
          label="Clear all"
          icon={X}
          on={anything}
          danger
          disabled={!anything || busy}
          onClick={() => void run(clearAll)}
        />
        {layers.map((layer) => (
          <StripButton
            key={layer.id}
            label={layer.on ? `Clear ${layer.label.toLowerCase()}` : layer.label}
            icon={layer.icon}
            on={layer.on}
            disabled={!layer.on || busy}
            onClick={() => void run(layer.clear)}
          />
        ))}
      </div>
    </div>
  )
}

function StripButton({
  label,
  icon: Icon,
  on,
  danger = false,
  disabled,
  onClick,
}: {
  label: string
  icon: Icon
  on: boolean
  danger?: boolean
  disabled: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <div className="max-h-8 min-h-0 flex-1" data-tooltip={label} data-tooltip-side="left">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'grid h-full w-full place-items-center rounded-md transition-colors',
          // Lit = something is on that layer. Clear all is solid red; a layer turns red on hover, because a click takes it down.
          on
            ? danger
              ? 'bg-red-900 text-white hover:bg-red-700'
              : 'bg-surface-elevated text-white hover:bg-red-900/60 hover:text-red-200'
            : 'text-zinc-600',
          'disabled:cursor-default',
        )}
      >
        <Icon size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
