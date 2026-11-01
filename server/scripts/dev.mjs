import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDevProcesses } from '../../scripts/dev-processes.mjs'

const require = createRequire(import.meta.url)
const wranglerCli = resolve(dirname(require.resolve('wrangler/package.json')), require('wrangler/package.json').bin.wrangler)
const debug = process.argv.includes('--debug')
const serverRoot = fileURLToPath(new URL('../', import.meta.url))
process.exitCode = await runDevProcesses([
  { name: 'API', command: process.execPath, args: [require.resolve('@nestjs/cli/bin/nest.js'), 'start', ...(debug ? ['--debug'] : []), '--watch'] },
  { name: 'Audience', command: process.execPath, args: [wranglerCli, 'dev', '--config', 'wrangler.audience.local.jsonc', '--local'] },
], { cwd: serverRoot })
