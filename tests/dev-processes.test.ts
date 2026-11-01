import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

async function exercise(fail: boolean): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'kairo-dev-processes-'))
  let parent: ReturnType<typeof spawn> | undefined
  try {
    const log = join(dir, 'events')
    const fixture = join(dir, 'child.mjs')
    await writeFile(fixture, `import {appendFileSync} from 'node:fs';import {spawn} from 'node:child_process';
      const [id,file,mode]=process.argv.slice(2);
      appendFileSync(file,id+':started\\n');
      process.on('SIGTERM',()=>{appendFileSync(file,id+':stopped\\n');process.exit(0)});
      if(id==='api')spawn(process.execPath,[process.argv[1],'api-child',file,'wait'],{stdio:'ignore'});
      if(mode==='fail')setTimeout(()=>process.exit(7),300);
      setInterval(()=>{},1000);`)
    const url = pathToFileURL(resolve('scripts/dev-processes.mjs')).href
    const commands = ['api', 'audience'].map(id => ({ name: id, command: process.execPath, args: [fixture, id, log, fail && id === 'api' ? 'fail' : 'wait'] }))
    parent = spawn(process.execPath, ['--input-type=module', '-e', `import {runDevProcesses} from ${JSON.stringify(url)};process.exitCode=await runDevProcesses(${JSON.stringify(commands)});`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let errors = ''
    parent.stderr!.on('data', chunk => { errors += chunk })
    const exit = new Promise<number | null>(resolve => parent!.once('exit', resolve))
    const deadline = Date.now() + 5000
    let ready = false
    while (!ready) {
      const events = await readFile(log, 'utf8').catch(() => '')
      ready = events.includes('api:started') && events.includes('audience:started') && events.includes('api-child:started')
      if (ready) break
      if (Date.now() > deadline) throw new Error(`Both services did not start: ${errors}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    if (!fail) parent.kill('SIGINT')
    const code = await exit
    assert.equal(code, fail ? 7 : 0)
    const events = await readFile(log, 'utf8')
    assert.match(events, /audience:stopped/)
    assert.match(events, /api-child:stopped/)
    if (!fail) assert.match(events, /api:stopped/)
  } finally {
    parent?.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }
}

test('one server command starts both services and Ctrl+C stops both', { timeout: 12000, skip: process.platform === 'win32' ? 'Programmatic POSIX signal integration; Windows uses taskkill process trees.' : false }, async () => exercise(false))
test('a failed service stops its sibling and preserves the failure exit code', { timeout: 12000, skip: process.platform === 'win32' ? 'Programmatic POSIX signal integration; Windows uses taskkill process trees.' : false }, async () => exercise(true))
