#!/usr/bin/env node
/**
 * Deterministic main-process test runner.
 *
 * Why this exists: `npm run test:main` used to pass shell globs
 * (`src/main/__tests__/*.test.ts`) through npm scripts. Unix shells expand
 * those; Windows cmd.exe does not, so tsx received the literal `*` pattern
 * and died with "Could not find ...". This script expands the globs itself
 * with `fs.globSync` and spawns Electron with explicit file paths — no shell,
 * no glob, no `cross-env` needed (env is set in-process).
 *
 * Must run from the repo root (npm scripts do).
 */
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { createRequire } from 'node:module'

const PATTERNS = [
  'src/main/__tests__/*.test.ts',
  'src/main/services/scripture/__tests__/*.test.ts',
  'src/main/services/propresenter/__tests__/*.test.ts',
  'src/main/services/cloud/__tests__/*.test.ts',
  'src/main/services/ndi/__tests__/*.test.ts',
  'src/main/services/documents/__tests__/*.test.ts',
]

const files = PATTERNS.flatMap((pattern) => {
  const matches = globSync(pattern).sort()
  if (matches.length === 0) {
    console.error(`test-main: pattern matched no files: ${pattern}`)
    process.exit(1)
  }
  return matches
})

const require = createRequire(import.meta.url)
// The `electron` package exports the path to the Electron binary.
const electronBin = require('electron')

const result = spawnSync(
  electronBin,
  ['./node_modules/tsx/dist/cli.mjs', '--test', ...files],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
process.exit(result.status ?? 1)
