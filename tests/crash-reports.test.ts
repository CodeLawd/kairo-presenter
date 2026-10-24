import assert from 'node:assert/strict'
import test from 'node:test'
import { CRASH_MAX_REPORTS, logTail, scrubHome, type CrashReport, type CrashUpload } from '../src/lib/cloud/crashes'
import { CrashReporter, type CrashDeps } from '../src/main/services/crash-reports/reporter'

const HOME = 'C:\\Users\\ATS'
const crash = { kind: 'renderer', process: 'main-window', reason: 'crashed', exitCode: -36861 } as const

function rig(options: { enabled?: boolean; online?: boolean; log?: string; fail?: boolean } = {}) {
  let queue: CrashReport[] = []
  let now = Date.parse('2026-10-24T11:54:40Z')
  let ids = 0
  let enabled = options.enabled ?? true
  const uploads: CrashUpload[] = []
  const deps: CrashDeps = {
    load: () => queue.map((r) => ({ ...r })),
    save: (reports) => { queue = reports },
    enabled: () => enabled,
    canUpload: () => options.online ?? true,
    upload: async (body) => {
      uploads.push(body)
      if (options.fail) throw new Error('offline')
      return { accepted: body.reports.map((r) => r.id) }
    },
    installId: () => 'install-1',
    system: () => ({ os: 'win32', osVersion: '10.0.26100', arch: 'x64', appVersion: '1.0.13', electronVersion: '39', memoryGb: 16, gpu: {} }),
    readLog: () => options.log ?? `[info] Kairo starting\n[info] path: 'C:\\\\Users\\\\ATS\\\\Documents\\\\Kairo Presenter'\n`,
    home: HOME,
    windows: true,
    now: () => now,
    newId: () => `id-${++ids}`,
    warn: () => undefined,
  }
  return {
    reporter: new CrashReporter(deps),
    queue: () => queue,
    uploads,
    advance: (ms: number) => { now += ms },
    setEnabled: (on: boolean) => { enabled = on },
  }
}

test('home folders are hidden in plain, escaped and any-case Windows paths', () => {
  const text = "C:\\Users\\ATS\\a 'C:\\\\Users\\\\ATS\\\\b' c:/users/ats/c"
  assert.equal(scrubHome(text, HOME, true), "~\\a '~\\\\b' ~/c")
  assert.equal(scrubHome('/Users/ats/x /Users/ATS/y', '/Users/ats', false), '~/x /Users/ATS/y')
})

test('the log tail keeps the last lines and starts on a whole line', () => {
  const log = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n') + '\n'
  const tail = logTail(log)
  assert.equal(tail.split('\n').length, 200)
  assert.ok(tail.startsWith('line 100'))
  assert.equal(logTail('aaaa\nbbbb\ncccc', 10, 7), 'cccc')
})

test('a crash is queued with the machine, recent errors and a scrubbed log', () => {
  const r = rig()
  r.reporter.noteError("TypeError: x is undefined (file:///C:/Users/ATS/app.js:1)")
  r.reporter.record(crash)
  const [report] = r.queue()
  assert.equal(report.process, 'main-window')
  assert.equal(report.exitCode, -36861)
  assert.equal(report.count, 1)
  assert.equal(report.system.appVersion, '1.0.13')
  assert.match(report.errors[0], /TypeError/)
  assert.doesNotMatch(report.log + report.errors.join(''), /ATS/i)
})

test('the same crash within a minute joins one report; later or different ones do not', () => {
  const r = rig()
  r.reporter.record(crash)
  r.advance(3_500)
  r.reporter.record(crash)
  r.advance(3_500)
  r.reporter.record(crash)
  assert.equal(r.queue().length, 1)
  assert.equal(r.queue()[0].count, 3)
  assert.notEqual(r.queue()[0].firstAt, r.queue()[0].lastAt)
  r.reporter.record({ ...crash, process: 'Projector' })
  r.advance(61_000)
  r.reporter.record({ ...crash, process: 'Projector' })
  assert.equal(r.queue().length, 3)
})

test('the queue keeps only the newest reports', () => {
  const r = rig()
  for (let i = 0; i < CRASH_MAX_REPORTS + 5; i++) r.reporter.record({ ...crash, exitCode: i })
  assert.equal(r.queue().length, CRASH_MAX_REPORTS)
  assert.equal(r.queue().at(-1)?.exitCode, CRASH_MAX_REPORTS + 4)
})

test('sent reports leave the queue; a failed send keeps them', async () => {
  const sent = rig()
  sent.reporter.record(crash)
  await sent.reporter.flush()
  assert.equal(sent.uploads.length, 1)
  assert.equal(sent.uploads[0].installId, 'install-1')
  assert.equal(sent.queue().length, 0)

  const failed = rig({ fail: true })
  failed.reporter.record(crash)
  await failed.reporter.flush()
  assert.equal(failed.queue().length, 1)

  const offline = rig({ online: false })
  offline.reporter.record(crash)
  await offline.reporter.flush()
  assert.equal(offline.uploads.length, 0)
  assert.equal(offline.queue().length, 1)
})

test('switched off: nothing is recorded, and anything queued is discarded unsent', async () => {
  const off = rig({ enabled: false })
  off.reporter.record(crash)
  assert.equal(off.queue().length, 0)

  const r = rig()
  r.reporter.record(crash)
  r.setEnabled(false)
  await r.reporter.flush()
  assert.equal(r.uploads.length, 0)
  assert.equal(r.queue().length, 0)
})
