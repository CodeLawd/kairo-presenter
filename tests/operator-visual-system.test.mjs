import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('operator workspace uses production labels without dashboard copy', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/operator/Operator.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /Operator Dashboard|telemetry & override panel/)
  assert.match(source, /Detected content/)
  assert.match(source, /Live output/)
})

test('visual tokens use warm graphite surfaces and a restrained ember accent', async () => {
  const source = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8')

  assert.match(source, /DEFAULT: 'rgb\(var\(--surface\) \/ <alpha-value>\)'/)
  assert.match(source, /500: '#f26b38'/)
  assert.match(source, /'glow-teal': 'none'/)
  assert.doesNotMatch(source, /filter: 'blur\(4px\)'/)
})

test('theme editor uses a preview-first three-pane workspace and theme-aware range controls', async () => {
  const editor = await readFile(
    new URL('../src/renderer/src/components/theme/ThemeEditor.tsx', import.meta.url),
    'utf8',
  )
  const css = await readFile(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')

  assert.match(editor, /Theme library/)
  assert.match(editor, /Apply to output/)
  assert.match(editor, /data-pane="library"/)
  assert.match(editor, /id="theme-preview"/)
  assert.match(editor, /data-pane="inspector"/)
  assert.match(editor, /ResizableHandle withHandle/)
  assert.match(editor, /minSize=\{PREVIEW_MIN\}/)
  assert.match(editor, /Theme controls/)
  assert.match(editor, /@\/components\/ui\/toggle-group/)
  assert.match(editor, /@\/components\/ui\/tabs/)
  assert.match(editor, /@\/components\/ui\/slider/)
  assert.match(editor, /@\/components\/ui\/resizable/)
  assert.match(editor, /@\/components\/ui\/dropdown-menu/)
  assert.match(editor, /bg-surface-secondary\/35/)
  assert.match(editor, /<SliderPrimitive/)
  assert.doesNotMatch(editor, /#009f9f|#243d5c/)
  assert.match(css, /--range-track:/)
  assert.match(css, /\.range-control::\-webkit-slider-thumb/)
})

test('primary workspaces compose shared shadcn controls instead of duplicating their main toolbars', async () => {
  const [operator, scripture, lyrics, settings] = await Promise.all([
    readFile(new URL('../src/renderer/src/components/operator/Operator.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/components/scripture/Scripture.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/components/lyrics/Lyrics.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/components/settings/Settings.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(operator, /@\/components\/ui\/button/)
  assert.match(operator, /@\/components\/ui\/input/)
  assert.match(operator, /@\/components\/ui\/switch/)
  assert.match(scripture, /@\/components\/ui\/select/)
  assert.match(scripture, /@\/components\/ui\/input/)
  assert.match(lyrics, /@\/components\/ui\/toggle-group/)
  assert.match(lyrics, /@\/components\/ui\/dropdown-menu/)
  assert.match(settings, /@\/components\/ui\/switch/)
  assert.match(settings, /@\/components\/ui\/slider/)
})

test('operator pipeline controls stay compact and separate routine and destructive actions', async () => {
  const operator = await readFile(
    new URL('../src/renderer/src/components/operator/Operator.tsx', import.meta.url),
    'utf8',
  )

  assert.match(operator, /Pipeline controls/)
  assert.match(operator, /variant="destructive"/)
  assert.match(operator, /Clear output/)
  assert.doesNotMatch(operator, /Emergency Clear/)
  assert.doesNotMatch(operator, /py-4\.5/)
})

test('scripture workspace scrolls when imported sermon playlists exceed the viewport', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/scripture/Scripture.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /h-full overflow-y-auto/)
  assert.match(source, /scrollbarGutter: 'stable'/)
})

test('deleting a sermon playlist requires explicit confirmation', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/scripture/Scripture.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /pendingDeletePlanId/)
  assert.match(source, />Cancel</)
  assert.match(source, />Delete</)
  assert.match(source, /Confirm deleting/)
})

test('sermon review can finish, accept searched verses, and persist drag ordering', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/scripture/Scripture.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /Done reviewing/)
  assert.match(source, /Add to playlist/)
  assert.match(source, /selectedPlanId/)
  assert.match(source, /draggable/)
  assert.match(source, /onDragStart/)
  assert.match(source, /reorderPlanItem/)
  assert.match(source, /saveSermonPlan/)
})

test('sermon review hides verse cards until completion and exposes a precise sortable drop target', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/components/scripture/Scripture.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /cardsSource === 'search' && cards\.length > 0/)
  assert.match(source, /dragOverItemId/)
  assert.match(source, /dropPosition/)
  assert.match(source, /getBoundingClientRect/)
  assert.match(source, /setActivePlan\(optimistic\)/)
  assert.match(source, /Drop .* (before|after)/)

  const finishReview = source.match(/const finishReview[\s\S]*?\n  }, \[cardsSource\]\)/)?.[0] ?? ''
  assert.doesNotMatch(finishReview, /setCards\(/)
})
