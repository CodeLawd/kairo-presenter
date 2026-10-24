<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Changelog

`src/lib/changelog.ts` is the content of the public `/changelog` page: one entry per release,
newest first, in plain language for church teams. Each release adds its entry before
`bun run release` (see "Releases" in the root `CLAUDE.md` / `AGENTS.md`); the release script
refuses to run without it.
