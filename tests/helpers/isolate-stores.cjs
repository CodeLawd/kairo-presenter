// Isolate legacy singleton stores imported by otherwise pure root tests.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-root-tests-'))
const original = Module._load
Module._load = function (name, parent, isMain) {
  const exported = original.apply(this, arguments)
  if (name === 'electron-store') {
    return class IsolatedElectronStore extends exported {
      constructor(options) { super({ ...options, cwd: dir }) }
    }
  }
  return exported
}
process.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }) })
