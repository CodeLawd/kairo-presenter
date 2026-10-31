import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalBibleInstaller } from '../local-bible-installer'

test('installation shares one request and retains progress after completion', async () => {
  let release!: () => void
  let downloads = 0
  let installs = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const installer = new LocalBibleInstaller({
    download: async (_id, update) => {
      downloads++
      update({ phase: 'downloading', receivedBytes: 5, totalBytes: 10 })
      await gate
      update({ phase: 'verifying', receivedBytes: 10, totalBytes: 10 })
      return Buffer.from('fixture')
    },
    install: (translation) => {
      installs++
      return { translation, installed: true, verseCount: 31_101, chapterCount: 1189 }
    },
  })
  const phases: string[] = []
  const unsubscribe = installer.subscribe(p => phases.push(p.phase))
  const first = installer.start('ampc')
  const second = installer.start('AMPC')
  assert.equal(first, second)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(installer.getProgress('AMPC')?.receivedBytes, 5)
  release()
  await first
  assert.equal(downloads, 1)
  assert.equal(installs, 1)
  assert.equal(installer.getProgress('AMPC')?.phase, 'ready')
  assert.ok(phases.includes('verifying'))
  assert.ok(phases.includes('installing'))
  assert.ok(installer.getProgress('AMPC')!.revision > 1)
  unsubscribe()
})

test('failure never installs, provides recovery text and can be retried', async () => {
  let fails = true
  let installs = 0
  const installer = new LocalBibleInstaller({
    download: async () => {
      if (fails) throw new TypeError('fetch failed')
      return Buffer.from('fixture')
    },
    install: translation => {
      installs++
      return { translation, installed: true, verseCount: 31_101, chapterCount: 1189 }
    },
  })
  await assert.rejects(installer.start('AMPC'), /internet connection/i)
  assert.equal(installs, 0)
  assert.equal(installer.getProgress('AMPC')?.phase, 'failed')
  assert.match(installer.getProgress('AMPC')?.error ?? '', /try again/i)
  fails = false
  await installer.start('AMPC')
  assert.equal(installs, 1)
  assert.equal(installer.getProgress('AMPC')?.phase, 'ready')
})
