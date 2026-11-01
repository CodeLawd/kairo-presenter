/** Read-only Electron integration: local selector fixtures + an owned live event.
 * bun run test:audience-slido -- 9374525
 * Add --moderator to sign in manually in the isolated source window.
 * Never submits questions, votes, approvals, replies or other upstream writes.
 */
const { app, BrowserWindow, session } = require('electron')
const { buildSync, build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const repo = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-slido-test-'))
app.on('window-all-closed', () => {})
app.setPath('userData', path.join(dir, 'profile'))
const code = process.argv.find(value => /^\d{4,10}$/.test(value)) || '9374525'
const moderator = process.argv.includes('--moderator')
let service
let exitCode = 0
const wait = async (predicate, milliseconds = 60000) => {
  const deadline = Date.now() + milliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for source state')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _path, error) => console.error('Source preload failed:', error.message))
  contents.on('did-fail-load', (_event, code, description, url, main) => { if (main) console.log('Navigation:', code, description, new URL(url).hostname) })
})
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(dir, 'main'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'preload'), { recursive: true })
  const selectorPath = path.join(repo, 'src/main/services/audience/sources/slido-selectors.ts')
  const selectorBundle = buildSync({ entryPoints: [selectorPath], bundle: true, write: false, format: 'iife', globalName: 'qaSelectors', platform: 'browser' }).outputFiles[0].text
  const fixture = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <div class="question-item" data-qid="7"><div data-testid="question-author">Anna</div><div data-testid="question-text">A visible question?</div><button class="score__btn--plus"><span>12</span></button></div>
    <div class="question-item" data-qid="8" hidden><div data-testid="question-text">Hidden must stay hidden</div><button class="score__btn--plus"><span>99</span></button></div>
    <div data-item-question-card aria-label="Question number 1 from Anonymous: A pending question? 3 votes"><div data-question-id="9" data-testid="question"><span data-testid="user-name">Anonymous</span><span class="questionText-1-2-123">A pending question?</span><span class="srOnly-1-2-123">3 votes</span></div></div>
  `))
  assert.deepEqual(await fixture.webContents.executeJavaScript(selectorBundle + '; qaSelectors.extractSlidoQuestions(document, "public")'), [{ externalId: '7', text: 'A visible question?', author: 'Anna', votes: 12 }])
  assert.deepEqual(await fixture.webContents.executeJavaScript('qaSelectors.extractSlidoQuestions(document, "moderator")'), [{ externalId: '9', text: 'A pending question?', author: null, votes: 3 }])
  fixture.destroy()
  console.log('PASS: public/moderator selectors, author, votes, hidden-card exclusion.')
  buildSync({ entryPoints: [path.join(repo, 'src/main/services/audience/sources/slido.ts')], outfile: path.join(dir, 'main/slido.cjs'), bundle: true, format: 'cjs', platform: 'node', external: ['electron'] })
  buildSync({ entryPoints: [path.join(repo, 'src/main/services/audience/service.ts')], outfile: path.join(dir, 'main/service.cjs'), bundle: true, format: 'cjs', platform: 'node' })
  const goodPreload = fs.readFileSync(path.join(repo, 'out/preload/audience-slido.js'))
  fs.writeFileSync(path.join(dir, 'preload/audience-slido.js'), goodPreload)
  const { SlidoAudienceSource, allowedSlidoNavigation } = require(path.join(dir, 'main/slido.cjs'))
  const { AudienceService } = require(path.join(dir, 'main/service.cjs'))
  assert.equal(allowedSlidoNavigation('https://app.sli.do/event/test'), true)
  for (const address of ['file:///tmp/x', 'javascript:alert(1)', 'https://sli.do.evil.example', 'http://app.sli.do']) assert.equal(allowedSlidoNavigation(address), false)
  service = new AudienceService({ showQuestion() {}, clearQuestion() {} })
  const source = new SlidoAudienceSource(code, moderator)
  source.onUpdate(update => { if (update.status) console.log('Source:', update.status.state, update.status.error || '') })
  await service.start(source)
  if (moderator) console.log('Sign in in the isolated source window and open the event. The test only reads.')
  await wait(() => service.getState().questions.length > 0, moderator ? 300000 : 60000)
  const state = service.getState()
  assert.equal(state.sources[0].state, 'live')
  assert.ok(state.questions.every(q => q.state === 'review'))
  const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('sli.do/event/'))
  assert.ok(win)
  const preferences = win.webContents.getLastWebPreferences()
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.sandbox, true)
  assert.equal(win.webContents.session, session.fromPartition('persist:audience-slido'))
  if (!moderator) assert.equal(win.isVisible(), false)
  const selector = moderator ? '[data-question-id][data-testid="question"]' : '.question-item[data-qid]'
  const liveIds = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(el=>el.getClientRects().length).map(el=>el.getAttribute(${JSON.stringify(moderator ? 'data-question-id' : 'data-qid')}))`)
  assert.deepEqual(state.questions.map(q => q.id.split(':').at(-1)).sort(), liveIds.sort())
  console.log(`PASS: live ${moderator ? 'moderator' : 'public'} event ${code}; ${state.questions.length} visible questions read into Review; isolated window.`)
  if (!moderator) {
    const first = state.questions[0]
    await service.moderate(first.id, 'hidden')
    // Break only the local selector file in a test preload, not the remote DOM.
    const badPreload = (await build({ entryPoints: [path.join(repo, 'src/preload/audience-slido.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], plugins: [{ name: 'broken-test-selector', setup(build) {
      build.onLoad({ filter: /slido-selectors\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace(/publicText: '[^']*'/, "publicText: '[data-kairo-missing-selector]'"), loader: 'ts' }))
    } }] })).outputFiles[0].text
    await service.stop(source.id)
    fs.writeFileSync(path.join(dir, 'preload/audience-slido.js'), badPreload)
    await service.start(new SlidoAudienceSource(code, false))
    await wait(() => service.getState().sources.some(s => s.id === source.id && s.state === 'error'), 60000)
    const failed = service.getState()
    assert.equal(failed.questions.find(q => q.id === first.id).state, 'hidden')
    assert.equal(failed.questions.length, state.questions.length)
    assert.match(failed.sources.find(s => s.id === source.id).error, /changed their page/)
    console.log('PASS: broken selectors produce the loud error; existing queue and local moderation retained.')
  }
  service.shutdown()
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  console.log('PASS: application shutdown destroys source windows synchronously.')
}).catch(error => { console.error(error); exitCode = 1 }).finally(async () => {
  if (service) for (const source of service.getState().sources) await service.stop(source.id).catch(() => undefined)
  for (const win of BrowserWindow.getAllWindows()) win.destroy()
  try {
    const isolated = session.fromPartition('persist:audience-slido')
    await isolated.clearStorageData()
    await isolated.clearCache()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch (error) { console.error('Could not remove isolated test profile:', error.message); exitCode = 1 }
  finally { app.exit(exitCode) }
})
