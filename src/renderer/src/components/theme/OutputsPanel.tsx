import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { makeOverlayOutput } from '@shared/overlay-defaults'
import { groupOutputsByLayer, layerLabel, layerOfKind, MAX_NDI_OUTPUTS } from '@shared/overlay-outputs'
import type {
  CustomOverlayTheme,
  NdiOutputStatus,
  OverlayOutput,
  OverlayOutputKind,
  PPLook,
  PPVideoInputInfo,
} from '@shared/ipc'

// ─── Copy ─────────────────────────────────────────────────────────────────────
// The operator has to understand WHERE each destination lands, because the
// screen mapping itself lives in ProPresenter's Looks, not in this app.

const KIND_LABEL: Record<OverlayOutputKind, string> = {
  ndi: 'Rendered slide (NDI)',
  library: 'ProPresenter library',
  message: 'Message overlay',
  stage: 'Stage message',
}

const KIND_HELP: Record<OverlayOutputKind, string> = {
  ndi: 'This app renders the slide with the theme below and sends it to ProPresenter as an NDI video input.',
  library: 'Triggers a matching presentation that already exists in your ProPresenter library.',
  message: 'ProPresenter’s Messages layer. Styling lives in ProPresenter; the Look decides which screens see it.',
  stage: 'Plain text to every stage screen. Only appears if that screen’s stage layout includes a Message field.',
}

const NEW_OUTPUT_KINDS: OverlayOutputKind[] = ['stage', 'message', 'library', 'ndi']

// ─── Panel ────────────────────────────────────────────────────────────────────

interface OutputsPanelProps {
  outputs: OverlayOutput[]
  onChange: (next: OverlayOutput[]) => void
  videoInputs: PPVideoInputInfo[]
  onRefreshVideoInputs: () => void
  looks: PPLook[]
  onRefreshLooks: () => void
  themeLibrary: CustomOverlayTheme[]
  status: NdiOutputStatus[]
  /** Writes the theme currently being edited onto an NDI output. */
  onApplyDraftTheme: (outputId: string) => void
  hasDraftChanges: boolean
}

export default function OutputsPanel({
  outputs,
  onChange,
  videoInputs,
  onRefreshVideoInputs,
  looks,
  onRefreshLooks,
  themeLibrary,
  status,
  onApplyDraftTheme,
  hasDraftChanges,
}: OutputsPanelProps): React.ReactElement {
  const update = (id: string, patch: Partial<OverlayOutput>): void => {
    onChange(outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const remove = (output: OverlayOutput): void => {
    if (!window.confirm(`Remove the “${output.name}” output?`)) return
    onChange(outputs.filter((o) => o.id !== output.id))
  }

  const add = (kind: OverlayOutputKind): void => {
    const id = `${kind}-${Date.now().toString(36)}`
    onChange([
      ...outputs,
      makeOverlayOutput(id, kind, {
        name: KIND_LABEL[kind],
        enabled: false,
        order: outputs.length,
      }),
    ])
  }

  // Two enabled presentation-layer outputs compete for one layer — the second
  // only ever runs if the first fails. Say so, or it reads as a bug. Asks the
  // real grouping function rather than restating its predicate, so the warning
  // cannot drift away from what dispatch actually does.
  const presentationCount =
    groupOutputsByLayer(outputs).find((g) => g.layer === 'presentation')?.outputs.length ?? 0

  const ndiCount = outputs.filter((o) => o.kind === 'ndi').length

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Every enabled output receives the same verse at the same time. ProPresenter decides which
        screens actually show each one — that mapping lives in its Screen Configuration and Looks.
      </p>

      {presentationCount > 1 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            More than one output uses the Presentation layer. They can’t both be on screen, so
            they run in order and the first one that succeeds wins.
          </span>
        </p>
      )}

      {outputs.map((output) => (
        <OutputRow
          key={output.id}
          output={output}
          status={status.find((s) => s.id === output.id)}
          videoInputs={videoInputs}
          onRefreshVideoInputs={onRefreshVideoInputs}
          looks={looks}
          onRefreshLooks={onRefreshLooks}
          themeLibrary={themeLibrary}
          onUpdate={(patch) => update(output.id, patch)}
          onRemove={() => remove(output)}
          onApplyDraftTheme={() => onApplyDraftTheme(output.id)}
          hasDraftChanges={hasDraftChanges}
        />
      ))}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {NEW_OUTPUT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn-secondary flex items-center gap-1 px-2 py-1.5 text-[11px]"
            // Only one NDI feed can be live — a second needs a sender pool that
            // does not exist yet, so the normalizer force-disables extras.
            disabled={kind === 'ndi' && ndiCount >= MAX_NDI_OUTPUTS}
            onClick={() => add(kind)}
          >
            <Plus size={11} aria-hidden="true" />
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── One destination ──────────────────────────────────────────────────────────

interface OutputRowProps {
  output: OverlayOutput
  status?: NdiOutputStatus
  videoInputs: PPVideoInputInfo[]
  onRefreshVideoInputs: () => void
  looks: PPLook[]
  onRefreshLooks: () => void
  themeLibrary: CustomOverlayTheme[]
  onUpdate: (patch: Partial<OverlayOutput>) => void
  onRemove: () => void
  onApplyDraftTheme: () => void
  hasDraftChanges: boolean
}

function OutputRow({
  output,
  status,
  videoInputs,
  onRefreshVideoInputs,
  looks,
  onRefreshLooks,
  themeLibrary,
  onUpdate,
  onRemove,
  onApplyDraftTheme,
  hasDraftChanges,
}: OutputRowProps): React.ReactElement {
  const layer = layerOfKind(output.kind)
  const notReady = output.enabled && status && !status.ready

  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border p-3 transition-colors',
        output.enabled ? 'border-teal-500/30 bg-teal-500/5' : 'border-surface-border bg-surface-secondary/30'
      )}
    >
      <div className="flex items-start gap-2">
        <Switch
          checked={output.enabled}
          onCheckedChange={(enabled) => onUpdate({ enabled })}
          aria-label={`Enable ${output.name}`}
        />
        <div className="min-w-0 flex-1">
          <DeferredInput
            className="w-full bg-transparent text-xs font-semibold text-white outline-none focus:underline"
            value={output.name}
            onCommit={(name) => onUpdate({ name })}
            aria-label="Output name"
          />
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
            {KIND_LABEL[output.kind]} · {layerLabel(layer)}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:text-red-400"
          onClick={onRemove}
          aria-label={`Remove ${output.name}`}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>

      <p className="text-[10px] leading-snug text-slate-500">{KIND_HELP[output.kind]}</p>

      {notReady && (
        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-400">
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span>Not ready — {status?.reason ?? 'unknown reason'}.</span>
        </p>
      )}

      {output.enabled && status?.ready && (
        <p className="flex items-center gap-1.5 text-[10px] text-teal-400">
          <Check size={11} aria-hidden="true" />
          Ready
        </p>
      )}

      {output.kind === 'ndi' && (
        <NdiOutputFields
          output={output}
          onUpdate={onUpdate}
          videoInputs={videoInputs}
          onRefreshVideoInputs={onRefreshVideoInputs}
          themeLibrary={themeLibrary}
          onApplyDraftTheme={onApplyDraftTheme}
          hasDraftChanges={hasDraftChanges}
        />
      )}

      {/* — kind: message | stage — */}
      {(output.kind === 'message' || output.kind === 'stage') && (
        <Field label="Template" htmlFor={`${output.id}-template`}>
          <DeferredTextarea
            id={`${output.id}-template`}
            className="input min-h-[52px] w-full resize-y font-mono text-[11px]"
            value={output.template}
            onCommit={(template) => onUpdate({ template })}
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Tokens: <code>{'{Reference}'}</code> and <code>{'{Text}'}</code>.
          </p>
        </Field>
      )}

      {output.kind === 'stage' && (
        <p className="rounded-lg bg-surface-secondary/60 p-2 text-[10px] leading-snug text-slate-400">
          Set up in ProPresenter: the stage screen’s layout must include a <b>Message</b> field, or
          this text has nowhere to appear.
        </p>
      )}

      {/* — every kind — */}
      <Field label="Trigger Look (optional)" htmlFor={`${output.id}-look`}>
        <div className="flex items-center gap-2">
          <select
            id={`${output.id}-look`}
            className="input flex-1"
            value={output.lookId}
            onChange={(e) => onUpdate({ lookId: e.target.value })}
          >
            <option value="">— leave the operator’s Look alone —</option>
            {looks.map((look) => (
              <option key={look.id} value={look.id}>{look.name}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary px-2 py-2 text-[11px]" onClick={onRefreshLooks}>
            Refresh
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          A Look decides which layers each screen shows. Only the first Look configured across all
          outputs is triggered — a Look is whole-system state.
        </p>
      </Field>

      <label className="flex items-start gap-2 text-[10px] leading-snug text-slate-400">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={output.fallbackOnly}
          onChange={(e) => onUpdate({ fallbackOnly: e.target.checked })}
        />
        <span>Last resort — push only if every other output failed.</span>
      </label>
    </div>
  )
}

/**
 * Keeps an edited value local and reports it on blur (or Enter). Every keystroke
 * on these would otherwise reach `persist` → a settings IPC round trip carrying
 * every output's full theme → a whole-file disk write.
 */
function useDeferredValue(
  value: string,
  onCommit: (next: string) => void
): {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onBlur: () => void
} {
  const [draft, setDraft] = useState(value)

  // Adopt external changes (theme switch, another tab).
  useEffect(() => setDraft(value), [value])

  return {
    value: draft,
    onChange: (e) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) onCommit(draft)
    },
  }
}

function DeferredInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (next: string) => void
} & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'onBlur'>): React.ReactElement {
  const bound = useDeferredValue(value, onCommit)
  return (
    <input
      {...rest}
      {...bound}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function DeferredTextarea({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (next: string) => void
} & Omit<React.ComponentPropsWithoutRef<'textarea'>, 'value' | 'onChange' | 'onBlur'>): React.ReactElement {
  const bound = useDeferredValue(value, onCommit)
  return <textarea {...rest} {...bound} />
}

/** The controls only an `ndi` output has — five props the rest of the row ignores. */
function NdiOutputFields({
  output,
  onUpdate,
  videoInputs,
  onRefreshVideoInputs,
  themeLibrary,
  onApplyDraftTheme,
  hasDraftChanges,
}: {
  output: OverlayOutput
  onUpdate: (patch: Partial<OverlayOutput>) => void
  videoInputs: PPVideoInputInfo[]
  onRefreshVideoInputs: () => void
  themeLibrary: CustomOverlayTheme[]
  onApplyDraftTheme: () => void
  hasDraftChanges: boolean
}): React.ReactElement {
  return (
    <>
      <Field label="Theme" htmlFor={`${output.id}-theme`}>
        <div className="flex items-center gap-2">
          <select
            id={`${output.id}-theme`}
            className="input flex-1"
            value={output.themeId ?? ''}
            onChange={(e) => {
              const themeId = e.target.value
              const found = themeLibrary.find((item) => item.id === themeId)
              onUpdate(found ? { themeId, theme: structuredClone(found.theme) } : { themeId: null })
            }}
          >
            <option value="">— custom (edited here) —</option>
            {themeLibrary.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary px-2 py-2 text-[11px] disabled:opacity-40"
            onClick={onApplyDraftTheme}
            disabled={!hasDraftChanges}
            title="Send the theme you are editing to this output"
          >
            Apply draft
          </button>
        </div>
      </Field>

      {/* PP hides NDI source names, so auto-discovery can't identify ours —
          the user picks the input once and we persist the uuid. */}
      <Field label="ProPresenter video input" htmlFor={`${output.id}-input`}>
        <div className="flex items-center gap-2">
          <select
            id={`${output.id}-input`}
            className="input flex-1"
            value={output.ppVideoInputUuid}
            onChange={(e) => onUpdate({ ppVideoInputUuid: e.target.value })}
          >
            <option value="">— not bound —</option>
            {videoInputs.map((vi) => (
              <option key={vi.uuid} value={vi.uuid}>{vi.name}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary px-2 py-2 text-[11px]" onClick={onRefreshVideoInputs}>
            Refresh
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          Pick the PP Video Input you created for the “ProAutomate Scripture” NDI source. PP labels
          inputs “Input N” — check PP’s Video Inputs list if unsure.
        </p>
      </Field>
    </>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}
