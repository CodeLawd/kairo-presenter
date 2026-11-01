import { useEffect, useRef, useState } from 'react'
import type { AudienceSession } from '@shared/audience'
import {
  renderQuestionHTML,
  type ProgramQuestionStyle,
} from '@shared/program'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const FRAME_W = 1920
const FRAME_H = 1080
const ROW = 'flex items-center justify-between gap-4 px-3.5 py-2.5 text-[12px] text-zinc-200'
const SUBLABEL = 'block text-[11px] text-zinc-500'

interface ThemePreset {
  id: string
  label: string
  color: string
  background: string
  backgroundOpacity: number
}

const THEME_PRESETS: ThemePreset[] = [
  { id: 'slate', label: 'Slate', color: '#ffffff', background: '#18212d', backgroundOpacity: 95 },
  { id: 'midnight', label: 'Midnight', color: '#ffffff', background: '#0c0c0e', backgroundOpacity: 92 },
  { id: 'stage-blue', label: 'Stage Blue', color: '#ffffff', background: '#17377a', backgroundOpacity: 95 },
  { id: 'emerald', label: 'Emerald', color: '#f0fdf4', background: '#0c3b2e', backgroundOpacity: 95 },
  { id: 'warm', label: 'Warm', color: '#fef3c7', background: '#3b2110', backgroundOpacity: 95 },
  { id: 'light', label: 'Light', color: '#111827', background: '#f8fafc', backgroundOpacity: 98 },
]

/** How questions, polls and the join QR code look on screens. */
export function QuestionStyle({
  session,
  style,
  error,
  onChange,
}: {
  session?: AudienceSession | null
  style: ProgramQuestionStyle
  error?: string
  onChange: (patch: Partial<ProgramQuestionStyle>) => void
}): React.ReactElement {
  const [previewMode, setPreviewMode] = useState<'question' | 'join'>('question')
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const [previewWidth, setPreviewWidth] = useState(320)

  useEffect(() => {
    const node = previewContainerRef.current
    if (!node) return
    const updateSize = (): void => {
      if (node.clientWidth > 0) setPreviewWidth(node.clientWidth)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const update = (patch: Partial<ProgramQuestionStyle>): void => {
    onChange(patch)
  }

  const previewHtml = renderQuestionHTML(
    previewMode === 'join'
      ? {
          kind: 'join',
          code: session?.code ?? '2AGXHS',
          url: (session?.url ?? 'usekairo.com/q/2AGXHS').replace(/^https?:\/\//, ''),
          qrDataUrl: session?.qrDataUrl ?? '',
        }
      : {
          author: 'Sarah Jenkins',
          text: 'How can we support families in our community who are going through a difficult season right now?',
        },
    style,
  )

  const scale = previewWidth / FRAME_W

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned Top 16:9 Screen Preview */}
      <div className="shrink-0 border-b border-white/10 bg-surface-secondary/50 px-6 py-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-400">Screen preview</span>
          <SegmentedControl
            label="Preview type"
            fit
            className="h-6 bg-surface-tertiary p-0.5"
            itemClassName="px-2.5 text-[11px]"
            value={previewMode}
            onChange={setPreviewMode}
            options={[
              { value: 'question', label: 'Question' },
              { value: 'join', label: 'Join code' },
            ]}
          />
        </div>
        <div className="mx-auto max-w-[336px]">
          <div
            ref={previewContainerRef}
            className="relative w-full overflow-hidden rounded-lg ring-1 ring-white/10"
            style={{
              height: Math.round(FRAME_H * scale),
              background:
                'radial-gradient(circle at 50% 35%, rgba(38, 52, 74, 0.55), rgba(10, 10, 12, 0.95)), repeating-conic-gradient(rgb(var(--surface-stage)) 0% 25%, rgb(var(--surface-secondary)) 0% 50%) 0 0 / 16px 16px',
            }}
            aria-label="Live preview of question on screen"
          >
            <div
              className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
              style={{
                width: FRAME_W,
                height: FRAME_H,
                transform: `scale(${scale})`,
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable controls */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">

      {/* Theme presets */}
      <div>
        <span className="block text-[11px] font-medium text-zinc-400 mb-2">Theme presets</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {THEME_PRESETS.map((preset) => {
            const active =
              style.color.toLowerCase() === preset.color.toLowerCase() &&
              style.background.toLowerCase() === preset.background.toLowerCase()
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  update({
                    color: preset.color,
                    background: preset.background,
                    backgroundOpacity: preset.backgroundOpacity,
                  })
                }
                className={cn(
                  'group flex flex-col items-center gap-1.5 rounded-lg p-2 text-[11px] transition-colors',
                  active
                    ? 'bg-white/10 text-white ring-1 ring-teal-500'
                    : 'bg-surface-secondary text-zinc-400 hover:bg-surface-tertiary hover:text-zinc-200',
                )}
              >
                <span
                  className="flex h-7 w-full items-center justify-center rounded border border-white/15 text-[11px] font-bold shadow-sm"
                  style={{ backgroundColor: preset.background, color: preset.color }}
                >
                  Aa
                </span>
                <span className="truncate max-w-full">{preset.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Card & Typography */}
      <div>
        <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">Appearance &amp; layout</span>
        <div className="pref-group pref-group-dim rounded-lg bg-surface-secondary">
          <div className={ROW}>
            <span>Screen position</span>
            <SegmentedControl
              label="Question position"
              fit
              className="bg-surface-tertiary"
              value={style.position}
              onChange={(position) => update({ position })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'center', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
            />
          </div>

          <div className={ROW}>
            <span>Text alignment</span>
            <SegmentedControl
              label="Question text alignment"
              fit
              className="bg-surface-tertiary"
              value={style.align}
              onChange={(align) => update({ align })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
              ]}
            />
          </div>

          <div className={ROW}>
            <span>Font style</span>
            <SegmentedControl
              label="Question font family"
              fit
              className="bg-surface-tertiary"
              value={style.fontFamily}
              onChange={(fontFamily) => update({ fontFamily })}
              options={[
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
                { value: 'mono', label: 'Mono' },
              ]}
            />
          </div>

          <label className={ROW}>
            <span>Text size</span>
            <span className="flex items-center gap-2.5">
              <input
                type="range"
                className="range-control w-28"
                min={24}
                max={100}
                step={2}
                value={style.fontSizePx}
                onChange={(event) => update({ fontSizePx: Number(event.target.value) })}
              />
              <span className="w-9 text-right text-[12px] tabular-nums text-zinc-400">{style.fontSizePx}px</span>
            </span>
          </label>

          <label className={ROW}>
            <span>Text color</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase text-zinc-400">{style.color}</span>
              <input
                type="color"
                className="h-6 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                value={style.color}
                onChange={(event) => update({ color: event.target.value })}
              />
            </span>
          </label>

          <label className={ROW}>
            <span>Card color</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase text-zinc-400">{style.background}</span>
              <input
                type="color"
                className="h-6 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                value={style.background}
                onChange={(event) => update({ background: event.target.value })}
              />
            </span>
          </label>

          <label className={ROW}>
            <span>Card opacity</span>
            <span className="flex items-center gap-2.5">
              <input
                type="range"
                className="range-control w-28"
                min={0}
                max={100}
                step={5}
                value={style.backgroundOpacity}
                onChange={(event) => update({ backgroundOpacity: Number(event.target.value) })}
              />
              <span className="w-9 text-right text-[12px] tabular-nums text-zinc-400">{style.backgroundOpacity}%</span>
            </span>
          </label>

          <label className={ROW}>
            <span>Card width</span>
            <span className="flex items-center gap-2.5">
              <input
                type="range"
                className="range-control w-28"
                min={50}
                max={100}
                step={5}
                value={style.widthPct}
                onChange={(event) => update({ widthPct: Number(event.target.value) })}
              />
              <span className="w-9 text-right text-[12px] tabular-nums text-zinc-400">{style.widthPct}%</span>
            </span>
          </label>

          <label className={ROW}>
            <span>Corner rounding</span>
            <span className="flex items-center gap-2.5">
              <input
                type="range"
                className="range-control w-28"
                min={0}
                max={48}
                step={4}
                value={style.borderRadiusPx}
                onChange={(event) => update({ borderRadiusPx: Number(event.target.value) })}
              />
              <span className="w-9 text-right text-[12px] tabular-nums text-zinc-400">{style.borderRadiusPx}px</span>
            </span>
          </label>

          <label className={cn(ROW, 'cursor-pointer')}>
            <span className="min-w-0">
              <span className="block text-[12px] text-zinc-200">Show sender name</span>
              <span className={SUBLABEL}>Display who asked the question above the text.</span>
            </span>
            <Switch
              size="sm"
              checked={style.showAuthor}
              onCheckedChange={(showAuthor) => update({ showAuthor })}
              aria-label="Show sender name"
            />
          </label>
        </div>
      </div>

      {/* Join Code & QR Screen Settings */}
      <div>
        <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">Join screen &amp; QR code on screen</span>
        <div className="pref-group pref-group-dim rounded-lg bg-surface-secondary">
          <label className={ROW}>
            <span className="shrink-0">Prompt headline</span>
            <input
              type="text"
              maxLength={80}
              placeholder="Ask a question"
              value={style.joinHeadline}
              onFocus={() => setPreviewMode('join')}
              onChange={(event) => update({ joinHeadline: event.target.value })}
              className="input h-7 max-w-[210px] bg-surface-tertiary px-2.5 py-0 text-[12px]"
            />
          </label>

          <label className={ROW}>
            <span>QR code size</span>
            <span className="flex items-center gap-2.5">
              <input
                type="range"
                className="range-control w-28"
                min={160}
                max={400}
                step={20}
                value={style.qrSizePx}
                onFocus={() => setPreviewMode('join')}
                onChange={(event) => {
                  setPreviewMode('join')
                  update({ qrSizePx: Number(event.target.value) })
                }}
              />
              <span className="w-9 text-right text-[12px] tabular-nums text-zinc-400">{style.qrSizePx}px</span>
            </span>
          </label>

          <label className={cn(ROW, 'cursor-pointer')}>
            <span className="min-w-0">
              <span className="block text-[12px] text-zinc-200">Show join link</span>
              <span className={SUBLABEL}>Display the web link underneath the join code.</span>
            </span>
            <Switch
              size="sm"
              checked={style.showJoinUrl}
              onCheckedChange={(showJoinUrl) => {
                setPreviewMode('join')
                update({ showJoinUrl })
              }}
              aria-label="Show join link"
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
        </p>
      )}
      </div>
    </div>
  )
}
