import test from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { EMPTY_PROGRAM_STATE, type ProgramState } from '../src/lib/program'
import { useAppStore } from '../src/renderer/src/stores/useAppStore'

let publish: (state: ProgramState) => void = () => {}
let unsubscribe: (() => void) | null = null
Object.assign(globalThis, { window: { api: { program: {
  onState: (listener: (state: ProgramState) => void) => { publish = listener; return () => {} },
  getState: async () => EMPTY_PROGRAM_STATE,
} } } })
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
loader._load = function (id, ...args) {
  if (id === 'react') return {
    useEffect: () => {}, useState: () => {},
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => ProgramState) => {
      unsubscribe = subscribe(() => {})
      return snapshot()
    },
  }
  return originalLoad.call(this, id, ...args)
}
const { useProgramState } = createRequire(__filename)('../src/renderer/src/hooks/useProgramState') as typeof import('../src/renderer/src/hooks/useProgramState')
loader._load = originalLoad

test('a main-process text clear removes the live preview without clearing on other program changes', async () => {
  useProgramState()
  await Promise.resolve()
  const live = { ...EMPTY_PROGRAM_STATE, current: { reference: 'John 1:3', text: 'He created everything.' } }
  publish(live)
  useAppStore.getState().setLiveOutputPreview({ kind: 'scripture', reference: 'John 1:3', text: 'He created everything.' })
  publish({ ...live, message: 'Welcome' })
  assert.equal(useAppStore.getState().liveOutputPreview?.reference, 'John 1:3')
  publish({ ...live, current: null })
  assert.equal(useAppStore.getState().liveOutputPreview, null)
  assert.equal(useAppStore.getState().liveOutputLabel, null)
  unsubscribe?.()
})
