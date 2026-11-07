#!/usr/bin/env node
/**
 * Drafts the changelog / What's New entry for the next release from the commits
 * since the last tag, and writes it at the top of website/src/lib/changelog.ts.
 *
 *   bun run changelog:draft            # draft for the next patch version
 *   bun run changelog:draft 1.1.0      # draft for an exact version
 *
 * The release script calls this when the entry is missing. Drafting uses
 * whichever coding agent is installed — Claude Code, Codex, Gemini CLI or
 * OpenCode — or CHANGELOG_AGENT to pick one or give any command; the Claude
 * API (ANTHROPIC_API_KEY) is the last resort. Always read the draft.
 */
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CHANGELOG_FILE = 'website/src/lib/changelog.ts'
const ICONS = ['operator', 'scripture', 'lyrics', 'documents', 'theme', 'media', 'screens', 'cloud', 'speed', 'tip']

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()

export function hasEntry(version, source = readFileSync(CHANGELOG_FILE, 'utf8')) {
  return new RegExp(`version:\\s*['"]${version.replace(/\./g, '\\.')}['"]`).test(source)
}

function commitsSinceLastTag() {
  // CHANGELOG_SINCE=v1.0.26 drafts from an older tag (handy for trying the prompt).
  let last = process.env.CHANGELOG_SINCE ?? ''
  if (!last) try { last = git('describe', '--tags', '--abbrev=0', '--match', 'v*') } catch { /* first release */ }
  const range = last ? `${last}..HEAD` : 'HEAD'
  const log = git('log', range, '--no-merges', '--format=- %s%n%b')
  return { last, log: log.length > 60000 ? `${log.slice(0, 60000)}\n…(truncated)` : log }
}

function recentEntries(source) {
  // The newest few entries, so the draft matches the house voice.
  const start = source.indexOf('export const changelog')
  return source.slice(start, start + 5000)
}

function buildPrompt(version, commits, examples) {
  return `You write release notes for Kairo, a desktop app churches use to put lyrics, scripture and media on screen during services.

Write the changelog entry for version ${version} from the commits below.

Rules:
- Write for church volunteers and staff, not developers: what they can now do, or what got fixed, in plain words.
- No commit hashes, file names, code identifiers, env vars or API details. No internal refactors, CI, tests or build changes.
- "title": a short headline (max ~6 words) for the release.
- "notes": 2–4 full sentences, the most noticeable change first.
- "highlights": 2–4 headline features for the in-app "What's New" sheet. Each: "icon" (one of ${ICONS.join(', ')}), "title" (2–5 words), "body" (1–2 sentences).
  Icon guide: operator = live presenting/controls, scripture = Bible, lyrics = songs, documents = slides/PDFs, theme = looks/design, media = video/images/audio, screens = displays/outputs, cloud = sign-in/sync/account, speed = faster/more reliable, tip = anything else.
- If nothing a church would notice changed, return {"skip": true}.

Match the voice of these existing entries:
${examples}

Commits since ${commits.last || 'the first commit'}:
${commits.log || '(none)'}

Reply with ONLY a JSON object: {"title": string, "notes": string[], "highlights": [{"icon": string, "title": string, "body": string}]} or {"skip": true}.`
}

/**
 * Coding-agent CLIs that can answer one prompt non-interactively. Each gets
 * the prompt and returns its reply as text. Tried in this order unless
 * CHANGELOG_AGENT picks one (by name, or any shell command that reads the
 * prompt on stdin and prints the reply, e.g. CHANGELOG_AGENT="llm -m gpt-5").
 */
const AGENTS = {
  claude: (prompt) => exec('claude', ['-p', '--output-format', 'text'], prompt),
  codex: (prompt) => {
    const out = join(mkdtempSync(join(tmpdir(), 'kairo-changelog-')), 'reply.txt')
    exec('codex', ['exec', '--skip-git-repo-check', '--output-last-message', out, '-'], prompt)
    return readFileSync(out, 'utf8')
  },
  gemini: (prompt) => exec('gemini', ['-p', ''], prompt),
  opencode: (prompt) => exec('opencode', ['run', prompt]),
}

function exec(cmd, args, input) {
  return execFileSync(cmd, args, {
    input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'],
  })
}

function installed(cmd) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true } catch { return false }
}

async function ask(prompt) {
  const chosen = process.env.CHANGELOG_AGENT?.trim()
  if (chosen) {
    console.log(`  using ${chosen}`)
    if (AGENTS[chosen]) return AGENTS[chosen](prompt)
    return execSync(chosen, { input: prompt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'] })
  }
  for (const [name, run] of Object.entries(AGENTS)) {
    if (!installed(name)) continue
    console.log(`  using ${name}`)
    try { return run(prompt) } catch (error) { console.warn(`  ${name} failed: ${error.message.split('\n')[0]}`) }
  }
  if (process.env.ANTHROPIC_API_KEY) return askApi(prompt)
  throw new Error(`No agent CLI (${Object.keys(AGENTS).join(', ')}) worked and ANTHROPIC_API_KEY is not set.
  Set CHANGELOG_AGENT to your agent's name or to a command that reads a prompt on stdin.`)
}

async function askApi(prompt) {
  console.log('  using the Claude API')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body.content.map((c) => c.text ?? '').join('')
}

function parseDraft(text) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const draft = JSON.parse(json)
  if (draft.skip) return null
  if (typeof draft.title !== 'string' || !Array.isArray(draft.notes) || draft.notes.length === 0) {
    throw new Error(`The draft is missing a title or notes:\n${text}`)
  }
  draft.highlights = (draft.highlights ?? [])
    .filter((h) => h && h.title && h.body)
    .map((h) => ({ icon: ICONS.includes(h.icon) ? h.icon : 'tip', title: h.title, body: h.body }))
  return draft
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function formatEntry(version, date, draft) {
  const lines = [
    '  {',
    `    version: ${q(version)},`,
    `    date: ${q(date)},`,
    `    title: ${q(draft.title)},`,
    '    notes: [',
    ...draft.notes.map((n) => `      ${q(n)},`),
    '    ],',
  ]
  if (draft.highlights.length) {
    lines.push('    highlights: [')
    for (const h of draft.highlights) lines.push(`      { icon: ${q(h.icon)}, title: ${q(h.title)}, body: ${q(h.body)} },`)
    lines.push('    ],')
  }
  lines.push('  },')
  return lines.join('\n')
}

/**
 * Drafts and writes the entry. Returns the entry text, or null when the
 * commits hold nothing a church would notice.
 */
export async function draftChangelog(version) {
  const source = readFileSync(CHANGELOG_FILE, 'utf8')
  if (hasEntry(version, source)) throw new Error(`${CHANGELOG_FILE} already has an entry for v${version}.`)
  const commits = commitsSinceLastTag()
  const draft = parseDraft(await ask(buildPrompt(version, commits, recentEntries(source))))
  if (!draft) return null
  const date = new Date().toLocaleDateString('en-CA')
  const entry = formatEntry(version, date, draft)
  const anchor = 'export const changelog: ChangelogEntry[] = [\n'
  if (!source.includes(anchor)) throw new Error(`Could not find "${anchor.trim()}" in ${CHANGELOG_FILE}.`)
  writeFileSync(CHANGELOG_FILE, source.replace(anchor, `${anchor}${entry}\n`))
  return entry
}

// Standalone: bun run changelog:draft [version]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2]
  const current = JSON.parse(readFileSync('package.json', 'utf8')).version
  const [major, minor, patch] = current.split('.').map(Number)
  const version = arg && /^\d+\.\d+\.\d+$/.test(arg) ? arg : `${major}.${minor}.${patch + 1}`
  console.log(`→ Drafting the v${version} entry from commits…`)
  try {
    const entry = await draftChangelog(version)
    if (!entry) console.log('  Nothing a church would notice — no entry written. Release with --skip-changelog.')
    else console.log(`\n${entry}\n\n✓ Written to ${CHANGELOG_FILE}. Preview it with: VITE_WHATS_NEW_PREVIEW=1 npm run dev`)
  } catch (error) {
    console.error(`\n✗ ${error.message}\n`)
    process.exit(1)
  }
}
