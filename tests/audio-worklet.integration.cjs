// npm run build && electron tests/audio-worklet.integration.cjs
// Synthetic audio only; no microphone permissions or operator settings are used.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-worklet-'))
app.setPath('userData', temporary)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let win
const timeout = setTimeout(() => { console.error('Audio integration timed out'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  fs.copyFileSync('out/renderer/audio/pcm-capture.worklet.js', path.join(temporary, 'pcm-capture.worklet.js'))
  buildSync({ entryPoints: ['src/renderer/src/audio/capture.ts'], outfile: path.join(temporary, 'capture.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'CaptureTest' })
  const appHtml = fs.readFileSync('out/renderer/index.html', 'utf8')
  const csp = appHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0]
  fs.writeFileSync(path.join(temporary, 'index.html'), `<html><head>${csp}<script src="./capture.js"></script></head><body></body></html>`)
  win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } })
  await win.loadFile(path.join(temporary, 'index.html'))
  const result = await win.webContents.executeJavaScript(`(async () => {
    const input = new AudioContext({ sampleRate: 16000 });
    const oscillator = input.createOscillator();
    const destination = input.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start(); await input.resume();
    let acquired;
    navigator.mediaDevices.getUserMedia = async () => {
      acquired = destination.stream.clone();
      return acquired;
    };
    const run = async () => {
      let packets = 0, levels = 0, nonzero = false, error;
      const capture = CaptureTest.createAudioCapture({
        deviceId: 'default', workletUrl: './pcm-capture.worklet.js',
        onPCM(pcm) { if (pcm.byteLength !== 1024) throw new Error('Wrong batch size'); packets++; nonzero ||= new Int16Array(pcm).some(x => x !== 0); },
        onLevel() { levels++; }, onError(e) { error = e.message; }
      });
      const ready = await capture.ready;
      await new Promise(r => setTimeout(r, 400));
      capture.stop();
      const count = packets;
      await new Promise(r => setTimeout(r, 100));
      return { ready, packets, levels, nonzero, stopped: acquired.getTracks().every(t => t.readyState === 'ended'), noLatePackets: count === packets, error };
    };
    const first = await run(), second = await run();
    let resolve;
    navigator.mediaDevices.getUserMedia = () => new Promise(r => { resolve = r; });
    const canceled = CaptureTest.createAudioCapture({ deviceId: 'default', workletUrl: './pcm-capture.worklet.js', onPCM() { throw new Error('Canceled capture sent audio'); }, onLevel() {}, onError() {} });
    canceled.stop();
    const lateStream = destination.stream.clone(); resolve(lateStream);
    const canceledReady = await canceled.ready;
    navigator.mediaDevices.getUserMedia = async () => { acquired = destination.stream.clone(); return acquired; };
    let failures = 0;
    const broken = CaptureTest.createAudioCapture({ deviceId: 'default', workletUrl: './missing-worklet.js', onPCM() {}, onLevel() {}, onError() { failures++; } });
    let rejected = false;
    try { await broken.ready; } catch { rejected = true; }
    const failureStopped = acquired.getTracks().every(t => t.readyState === 'ended');
    oscillator.stop(); destination.stream.getTracks().forEach(t => t.stop()); await input.close();
    return { first, second, canceledReady, failures, rejected, failureStopped, lateStopped: lateStream.getTracks().every(t => t.readyState === 'ended') };
  })()`)
  for (const run of [result.first, result.second]) {
    assert.equal(run.ready, true)
    assert.ok(run.packets >= 4, JSON.stringify(run))
    assert.ok(run.levels < run.packets)
    assert.equal(run.nonzero, true)
    assert.equal(run.stopped, true)
    assert.equal(run.noLatePackets, true)
    assert.equal(run.error, undefined)
  }
  assert.equal(result.canceledReady, false)
  assert.equal(result.lateStopped, true)
  assert.equal(result.failures, 1)
  assert.equal(result.rejected, true)
  assert.equal(result.failureStopped, true)
  console.log('PASS: Electron worklet loads under production CSP, streams 32ms PCM, throttles meters, restarts, and cleans up canceled capture.', JSON.stringify(result))
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timeout)
  win?.destroy()
  app.exit(process.exitCode || 0)
})
