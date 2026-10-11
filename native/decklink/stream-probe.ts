import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createPlaybackSink } from '../../src/main/services/video-devices/providers/decklink/client'
const [port, mode] = process.argv.slice(2)
if (!port || !mode) throw new Error('Provide PORT_ID and MODE_ID')
const child = spawn(resolve('native/decklink/build/decklink-helper'), ['--play', port, mode], { stdio: 'pipe' })
let report = ''
child.stdout.on('data', (data: Buffer) => { report += data.toString() })
async function run(): Promise<void> {
  const sink = await createPlaybackSink(child)
  const green = Buffer.from([0, 255, 0, 255])
  sink.setFrame(green, 1, 1)
  green.fill(0) // The transport must already own immutable bytes.
  // Freeze the Electron/Node producer completely; SDK callbacks still repeat.
  const end = Date.now() + 5000
  while (Date.now() < end) { /* Deliberate JS stall for qualification only. */ }
  await sink.close()
  console.log(report.trim())
  const final = report.trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.event === 'stopped')
  if (!final || final.completed < 100 || final.late || final.dropped || final.errors) throw new Error('Frozen producer qualification failed')
}
run().catch((error) => { console.error(error); child.kill('SIGKILL'); process.exitCode = 1 })
