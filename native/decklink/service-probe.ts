import { resolve } from 'node:path'
import { DeckLinkProvider } from '../../src/main/services/video-devices/providers/decklink'
import { VideoDeviceService } from '../../src/main/services/video-devices'
const [portId, modeId] = process.argv.slice(2)
if (!portId || !modeId) throw new Error('Provide PORT_ID and MODE_ID')
async function run(): Promise<void> {
  const provider = new DeckLinkProvider(resolve('native/decklink/build/decklink-helper'))
  const service = new VideoDeviceService([provider])
  try {
    await service.reconcile([{ id: 'probe', enabled: true, devicePortId: portId, deviceModeId: modeId, deviceKeyFill: false }])
    if (!service.outputStatus('probe').ready) throw new Error(service.outputStatus('probe').reason)
    service.sinkFor('probe')!.setFrame(Buffer.from([255, 0, 0, 255]), 1, 1)
    const end=Date.now()+5000
    while(Date.now()<end) { /* Deliberately freeze JS; hardware repeats natively. */ }
    if (!service.outputStatus('probe').ready) throw new Error(service.outputStatus('probe').reason)
    console.log(JSON.stringify({ready:true, modeId, ports:service.snapshot().ports.length, frozenProducerSeconds:5}))
  } finally { await service.close() }
}
run().catch(error=>{ console.error(error); process.exitCode=1 })
