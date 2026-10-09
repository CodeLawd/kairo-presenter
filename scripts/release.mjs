#!/usr/bin/env node
/**
 * One-command release: bump the version, commit, tag, push.
 *
 *   npm run release              # patch: 1.0.0 → 1.0.1
 *   npm run release -- minor     # 1.0.0 → 1.1.0
 *   npm run release -- major     # 1.0.0 → 2.0.0
 *   npm run release -- 1.4.0     # exact version
 *
 * Pushing the `v*` tag starts .github/workflows/release.yml, which builds Mac,
 * Windows and Linux and publishes the GitHub release the website downloads from.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const bump = process.argv[2] ?? 'patch'
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`Unknown version "${bump}". Use patch, minor, major or an exact version like 1.4.0.`)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })

// 1. Only release what is committed, so the build matches the tag.
if (git('status', '--porcelain')) {
  fail('You have uncommitted changes. Commit or stash them first, then run this again.')
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch === 'HEAD') fail('You are not on a branch (detached HEAD).')

// 2. Make sure this branch has everything that is on GitHub.
git('fetch', 'origin', '--tags', '--quiet')
const upstream = (() => {
  try { return git('rev-parse', '--abbrev-ref', `${branch}@{upstream}`) } catch { return '' }
})()
if (upstream && git('rev-list', '--count', `HEAD..${upstream}`) !== '0') {
  fail(`${upstream} has commits you don't have. Run "git pull" first.`)
}

const current = JSON.parse(readFileSync('package.json', 'utf8')).version
const next = nextVersion(current, bump)
if (git('tag', '--list', `v${next}`)) fail(`Tag v${next} already exists.`)

// 3. Confirm — this publishes to everyone who downloads Kairo.
console.log(`\n  Release Kairo v${current} → v${next}`)
console.log(`  from branch ${branch}${branch === 'main' ? '' : '  (not main)'}\n`)
const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = (await rl.question('  Publish this release? (y/N) ')).trim().toLowerCase()
rl.close()
if (answer !== 'y' && answer !== 'yes') fail('Cancelled. Nothing was changed.')

// 4. Check it builds before anything leaves this machine.
console.log('\n→ Typecheck and tests')
run('npm', ['run', 'typecheck'])
run('npm', ['test'])

// 5. Bump package.json + package-lock.json, commit "Release vX", tag vX.
console.log(`\n→ Bumping to v${next}`)
run('npm', ['version', next, '-m', 'Release v%s'])

// 6. Push the commit, then the tag — the tag starts the release build.
console.log('\n→ Pushing')
run('git', ['push', '-u', 'origin', branch])
run('git', ['push', 'origin', `v${next}`])

const repo = git('remote', 'get-url', 'origin').replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '')
console.log(`
✓ v${next} is building. It takes about 20–30 minutes.
  Progress:  https://github.com/${repo}/actions/workflows/release.yml
  Release:   https://github.com/${repo}/releases/tag/v${next}
`)

function nextVersion(version, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const [major, minor, patch] = version.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}
