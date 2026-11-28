# Backblaze and Dropbox Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver configurable Kairo-managed Backblaze storage and church-connected Dropbox with shared file management and reliable desktop sync.

**Architecture:** Use common church-scoped metadata, revisions and a persistent sync queue over two provider adapters. Keep B2 file transfer direct where verified capabilities allow it; mediate Dropbox through bounded backend streams so church permissions do not require sharing connector tokens. Keep presentation execution local.

**Tech Stack:** Existing Electron/React/TypeScript, Next.js, NestJS/Mongoose/MongoDB, better-sqlite3; add AWS S3 client/presigner for B2 server operations and a Dropbox server adapter after qualification. Use Bun for dependencies and checks.

**Spec:** [Cloud file storage design](011-cloud-file-storage-design.md). Read it first; defaults, role rules and failure semantics are normative proposed behaviour. This is a documentation deliverable, not authorisation to deploy or provision paid infrastructure.

## Global Constraints

- `nodeIntegration: false`, `contextIsolation: true` — never bypass.
- All renderer cloud operations go through `window.api` and main-process IPC. Node runtime dependencies belong in `dependencies`.
- Decimal sizes: 1 GB = 1,000,000,000 bytes. Initial managed allowance: 5 GB. No automatic active-file expiry at launch.
- Use live church-role checks. Church admin is distinct from Kairo platform admin. Provider secrets must never enter browser or renderer responses/logs.
- Existing local files require explicit church opt-in to upload. No changes to live scripture/audio/rendering latency paths.
- B2 and Dropbox use one metadata/sync contract; Dropbox files are not automatically copied to B2.
- Account for actual retained physical bytes and pending reservations, including Trash, replaced versions, previews and cleanup lag.
- Every mutation is retry-safe and revision-aware. No clock-based last-write-wins for file contents.
- One writable active connection per church; migration is copy/verify/cutover, never implicit source deletion.
- Use the existing API container boundary for Dropbox streaming; do not buffer entire videos or expose OAuth tokens to devices.

## Review Focus

1. Concurrent uploads, retries and expired reservations must not bypass quota or double-count usage (Tasks 2–3).
2. An external Dropbox move/delete/revocation must not silently destroy local work or upload to B2 (Tasks 5–6).
3. Church switching, role revocation and signed URL lifetime must have explicit access boundaries (Tasks 2–6).
4. Filesystem case collisions, unsafe names and watcher loops must be safe across supported desktop platforms (Task 5).
5. Remote edits and quota reduction must leave active presentations and existing readable content intact (Tasks 2, 4–5).

## Execution structure

Common foundation is followed by separately releasable B2, desktop-sync, Dropbox and migration phases. Keep each phase behind its own rollout flag. Do not launch both providers simultaneously before validating one complete end-to-end path.

Proposed new filenames below are intentional design boundaries, not existing implementations. Use `@contracts/storage` from server code; website imports the shared file through its existing shared-contract convention. Add narrowly scoped imports rather than enlarging the monolithic cloud contract file.

## Task 1: Qualify provider capabilities and lock the contract

**Files:**
- Create: `docs/decisions/cloud-storage-providers.md`
- Create: `src/lib/cloud/storage.ts`
- Create: `server/src/storage/providers/storage-provider.ts`
- Create: `server/src/storage/storage-contract.spec.ts`

**Interfaces:**
- `StorageProviderKind = 'b2' | 'dropbox'`.
- Define shared DTOs: `StoragePolicy`, `StorageUsage`, `StorageConnectionView`, `CloudFolder`, `CloudFile`, `BeginUploadInput`, `UploadSessionView`, `MutationInput`, `ChangePage`, `StorageSnapshot` and typed error codes. Inputs include church ID via authenticated route, client operation ID and base revision. Never accept raw provider keys from clients.
- `StoragePolicy` represents all settings/defaults in the spec; `StorageUsage` distinguishes logical/physical/reserved bytes, managed allowance and provider account capacity. File states include `uploading`, `verifying`, `ready`, `conflict`, `trashed`, `error`.
- Provider interface: `beginUpload(input: ProviderUploadInput): Promise<ProviderUploadHandle>`, `inspectObject(locator: ProviderLocator): Promise<ProviderObject>`, `openRead(locator: ProviderLocator, range?: ByteRange): Promise<Readable>`, `removeObject(locator: ProviderLocator): Promise<void>`, `abortUpload(handle: ProviderUploadHandle): Promise<void>`.
- Define these provider types in the same module. Locator includes connection ID and immutable object/version identity; `ProviderObject` includes actual size/type/provider revision but does not claim a verified SHA-256. Provider upload handles remain server-side; client session views contain only narrowly scoped capabilities or authenticated Kairo routes.

- [ ] Write contract tests that reject negative/noninteger bytes, unknown providers, client-selected storage locators and invalid revision/idempotency fields; assert 5 GB converts to exactly 5,000,000,000 bytes.
- [ ] Run `bun run --cwd server test -- --runInBand storage-contract`; verify the new assertions fail before implementing validation.
- [ ] Implement DTO validation and adapter interfaces. Record evidence for B2 signing, multipart/checksum behaviour, bucket/account limits, CORS, expected region latency and actual billed-byte metrics. Use documented capabilities first; use live scratch accounts only when explicitly authorised.
- [ ] Verify current Dropbox App Folder/OAuth, church-wide server-mediated access terms, refresh/revocation, upload sessions, Range reads, content-hash algorithm, cursors and webhook verification. Record production approval requirements. Unsupported semantics require a revised decision before that provider ships.
- [ ] Verify MongoDB replica-set transaction support in the intended deployment and document the atomic per-church mutation sequence strategy. Do not substitute a counter allocated ahead of commit, which can make clients miss changes.
- [ ] Rerun the contract tests and review the decision document against the spec. Commit this contract/decision as one reviewable change. Provider qualification gates rollout, not unrelated foundation work.

## Task 2: Implement admin policy, quotas and usage accounting

**Files:**
- Create: `server/src/storage/storage.module.ts`
- Create: `server/src/storage/schemas/storage-policy.schema.ts`
- Create: `server/src/storage/schemas/church-storage.schema.ts`
- Create: `server/src/storage/schemas/storage-upload.schema.ts`
- Create: `server/src/storage/schemas/storage-audit.schema.ts`
- Create: `server/src/storage/storage-policy.service.ts`
- Create: `server/src/storage/storage-quota.service.ts`
- Create: `server/src/storage/storage-admin.controller.ts`
- Create: `server/src/storage/storage-policy.spec.ts`, `server/src/storage/storage-quota.spec.ts`
- Modify: `server/src/app.module.ts`, `server/src/config/env.ts`, `server/src/config/env.spec.ts`, `server/cloudflare/environment.ts`

**Interfaces:**
- `StoragePolicyService.effective(orgId: string): Promise<StoragePolicy>` resolves expiring override > mapped plan > default and reports policy version/source.
- `StorageQuotaService.reserve(orgId: string, operationId: string, bytes: number): Promise<UploadSessionView>` transactionally reserves church/platform capacity and concurrency; repeated operation IDs return the original reservation.
- `StorageQuotaService.release(orgId: string, operationId: string): Promise<void>` is idempotent and can release only a reconciled/aborted reservation, not physically retained committed bytes.
- `GET/PATCH /v1/admin/storage/policy`, `GET /v1/admin/storage/usage`, `GET/PATCH /v1/admin/churches/:orgId/storage`; updates require current policy revision and an audit reason. Add validated superadmin provider configuration/status endpoints, never secret-value reads.

- [ ] Write policy tests for every spec default, precedence, override expiry, global-change impact preview, zero allowance, plan mismatch and unchanged files after quota reduction.
- [ ] Write Mongo replica-set tests: at 4 GB used with a 5 GB limit, two simultaneous 0.75 GB reservations yield one success; retries preserve one reservation; simultaneous reservations respect the platform ceiling; replacements reserve full new bytes. Add expired-session/late-completion cases.
- [ ] Run `bun run --cwd server test -- --runInBand storage-policy storage-quota`; verify these fail before adding services.
- [ ] Implement schemas with church indexes, transactional reservation/counter updates, persistent audit and endpoints protected by existing platform guards. Add deployment-secret plumbing with redacted validation errors and known-provider endpoint allowlists.
- [ ] Implement quota warnings, upload pauses, estimated budget thresholds and explicit over-quota state. Rate edits change estimates only; they do not rewrite past invoices. Zero/disabled limits have explicit semantics, not accidental unlimited behaviour.
- [ ] Rerun tests; assert a church admin cannot edit global policy, an ordinary platform admin cannot change infrastructure, policy-only staff cannot read media, and stale admin edits return conflict. Commit.

## Task 3: Deliver managed B2 file/folder API and durable cleanup

**Files:**
- Create under `server/src/storage/schemas/`: `storage-connection.schema.ts`, `cloud-folder.schema.ts`, `cloud-file.schema.ts`, `cloud-blob.schema.ts`, `storage-change.schema.ts`, `storage-job.schema.ts`
- Create: `server/src/storage/providers/b2.provider.ts`
- Create: `server/src/storage/storage-files.service.ts`, `storage-transfer.service.ts`, `storage-changes.service.ts`, `storage-jobs.service.ts`, `storage.controller.ts`
- Create: `server/src/storage/b2.provider.spec.ts`, `storage-files.spec.ts`, `storage-transfer.spec.ts`, `storage-jobs.spec.ts`, `storage-changes.spec.ts`
- Create: `server/test/storage.e2e-spec.ts`
- Modify: `server/package.json`, Bun lockfile, `server/src/storage/storage.module.ts`

**Interfaces:**
- `StorageFilesService.mutate(orgId: string, actorId: string, command: MutationInput): Promise<CloudFile | CloudFolder>` checks live roles, revisions, names and folder ancestry.
- `StorageTransferService.begin(orgId: string, actorId: string, input: BeginUploadInput): Promise<UploadSessionView>` delegates reservation to Task 2.
- `StorageTransferService.complete(orgId: string, actorId: string, uploadId: string): Promise<UploadSessionView>` schedules verification and returns stable status; it does not immediately trust the uploaded file.
- `StorageChangesService.list(orgId: string, cursor?: string): Promise<ChangePage>` returns committed ordered changes and a snapshot-required result for expired cursors.
- `StorageJobsService.runBatch(limit: number): Promise<number>` claims durable jobs with expiring leases; bounded backend workers call it. No correctness dependency on an individual process staying alive.
- Routes under `/v1/orgs/:orgId/storage`: `GET status`, `GET files`, `POST folders`, `POST mutations`, `POST uploads`, `POST uploads/:id/complete`, `DELETE uploads/:id`, `GET uploads/:id`, `POST files/:id/download`, `GET changes`, `GET snapshot`. Mutation commands cover rename, move, Trash, restore and purge.

- [ ] Add tests for cross-church access denial, same-church deduplication, empty folders, stable rename/move IDs, reference-aware deletion and folder cycle rejection. Test rejected unsigned/raw object locators.
- [ ] Add transfer tests for forged checksums/size/type, revoked membership at completion, duplicate completion, process crash after B2 upload, late multipart completion, oversize cleanup, B2 outages, five-minute URL expiry and post-issuance bearer access semantics.
- [ ] Add cursor tests where two mutations race: no committed change may be skipped, plus expired-cursor snapshot and queued local-edit preservation contract. Test leased cleanup retries and physical accounting until provider deletion succeeds.
- [ ] Run `bun run --cwd server test -- --runInBand storage b2.provider`; verify new tests fail before implementation.
- [ ] Implement B2 adapter, direct resumable transfers and independently computed SHA-256 verification in bounded jobs. Add server runtime dependencies with Bun; never put provider credentials in contracts. Produce thumbnails only with explicit resource limits and include their bytes in accounting.
- [ ] Implement safe listings/snapshots, ordered transactional change publication, reconciliation and job workers. Add unique operation IDs and blob references; no cross-tenant deduplication. Validate actual size after upload and document bounded oversize exposure.
- [ ] Implement paginated account/provider reconciliation, orphan/multipart cleanup, Trash retention and cost/egress estimates with actual-vs-issued metrics. Test thresholds do not falsely claim guaranteed invoice caps.
- [ ] Run unit tests and `bun run --cwd server test:e2e -- --runInBand storage.e2e-spec`. Check build with `bun run --cwd server build` and `bun run --cwd server cf:check`. Commit. Keep production flags disabled until authorised qualification succeeds.

## Task 4: Add admin controls and church file dashboard

**Files:**
- Create: `website/src/app/admin/storage/page.tsx`
- Modify: `website/src/app/admin/churches/[id]/page.tsx`, `website/src/app/admin/layout.tsx`, `website/src/lib/admin.ts`
- Create: `website/src/app/dashboard/files/page.tsx`, `website/src/app/dashboard/storage/page.tsx`
- Create focused components under `website/src/components/storage/`: `file-browser.tsx`, `upload-queue.tsx`, `storage-policy-form.tsx`, `storage-usage.tsx`, `storage-connection.tsx`
- Create: `website/src/lib/storage.ts`
- Modify: `website/src/app/dashboard/layout.tsx` and existing dashboard navigation component/config discovered from its imports
- Extend: `server/test/storage.e2e-spec.ts` with browser-facing role/status contracts

**Interfaces:**
- Website storage API functions consume Task 1 DTOs and Task 2–3 endpoints via `website/src/lib/api.ts`. Provider secrets never become form defaults or returned values.
- Admin forms save explicit policy revisions and display inherited/effective values. Website uploads share the resumable session contract used by desktop.

- [ ] Extend API tests to cover policy preview/save conflict, invalid file types, read-only viewers and over-quota readable files; run failing cases before endpoint adjustments.
- [ ] Implement `/admin/storage`, church overrides, usage/estimated costs, warning thresholds, configurable limits, provider availability and upload-pause controls. Display infrastructure health/configuration separately from secrets provisioned at deployment.
- [ ] Implement church Files/Storage pages, empty folders, upload state, preview/download, Trash/restore and explicit existing-media import. Label managed versus provider capacity clearly.
- [ ] Verify in browser with viewer/operator/church admin/platform admin accounts: 5 GB inherited quota, 20 GB override, quota downgrade, missing connection, interrupted upload, folder navigation, Trash, and inaccessible cross-church IDs. Verify keyboard access and narrow screens.
- [ ] Run `bun run --cwd website build` and relevant server tests; commit. Do not add a new browser test framework solely for reversible form/layout details.

## Task 5: Deliver persistent desktop file sync

**Files:**
- Create under `src/main/services/cloud/storage/`: `index.ts`, `queue.ts`, `database.ts`, `transfers.ts`, `reconcile.ts`, `paths.ts`
- Create: `src/lib/cloud/storage-sync.ts`
- Modify: `src/main/services/cloud/session.ts`, `src/main/services/workspace/index.ts`, `src/main/services/media/index.ts`
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `src/lib/ipc.ts`
- Create: `src/renderer/src/components/storage/StorageSettings.tsx`, `StorageStatus.tsx`
- Modify existing settings/media page discovered at implementation time to mount these components
- Create: `tests/storage-sync.test.ts`, `tests/storage-paths.test.ts`

**Interfaces:**
- `StorageSync.start(orgId: string): Promise<void>`, `stop(): Promise<void>`, `setOfflineFolders(ids: string[] | 'all'): Promise<void>`, `status(): StorageSyncStatus`, `retry(operationId: string): Promise<void>`.
- Define `StorageSyncStatus` and pure reconciliation inputs/results in `src/lib/cloud/storage-sync.ts`. Include connection/epoch, queued/error/conflict counts, selected dependency readiness, and last successful cursor/time.
- `window.api.storage` exposes status, subscription, opt-in/import, offline selection, pause/resume and retry through the existing IPC pattern. Main owns network, disk access and SQLite; renderer only presents state.

- [ ] Write tests for persisted outbox restart, interrupted multipart resume, initial import, no watcher echo uploads, case collisions, unsafe paths/symlinks, folder moves, remote Trash and snapshot recovery preserving unsent edits.
- [ ] Write tests for church switching/sign-out isolation, disconnected internet, expired URLs, stale provider epoch and remote updates while a video is held by the active presentation. Assert active files are neither replaced nor unlinked before release.
- [ ] Run `bun run test -- --test-name-pattern=storage` if the script forwards options appropriately; otherwise use `bun x tsx --test tests/storage-sync.test.ts tests/storage-paths.test.ts`. Verify intended failures first.
- [ ] Implement a dedicated SQLite queue/mapping store outside the synced folder, worker hashing, resumable bounded transfers, safe temporary writes and atomic adoption. Poll changes with jitter and backoff (30 seconds active / 5 minutes idle initially); reconnect immediately on network/focus recovery with throttling. WebSocket wake-up is optional later, not required for correct catch-up.
- [ ] Wire the main service to session/church changes and existing media/workspace changes without blocking rendering. Mount settings/status components; use existing navigation patterns rather than inventing a parallel settings system.
- [ ] Run `bun x tsx --test tests/storage-sync.test.ts tests/storage-paths.test.ts`, `bun run typecheck`, `bun run lint`, `bun run build`. Manually verify two desktop instances: empty folder creation, image/video/audio transfer, offline edits, conflict copy, reconnect and live playback protection. Commit.

## Task 6: Add church-owned Dropbox

**Files:**
- Create: `server/src/storage/providers/dropbox.provider.ts`, `dropbox-oauth.service.ts`, `dropbox-sync.service.ts`
- Create: `server/src/storage/dropbox.controller.ts`
- Create: `server/src/storage/dropbox.provider.spec.ts`, `dropbox-oauth.spec.ts`, `dropbox-sync.spec.ts`
- Modify: `server/src/storage/storage.module.ts`, connection schema, `server/src/config/env.ts`, `server/cloudflare/environment.ts`
- Modify: `website/src/components/storage/storage-connection.tsx`, `website/src/app/dashboard/storage/page.tsx`
- Extend: `server/test/storage.e2e-spec.ts`, `tests/storage-sync.test.ts`

**Interfaces:**
- `DropboxOAuthService.begin(orgId: string, actorId: string): Promise<{ authorizationUrl: string }>` stores one-time state bound to user/church/expiry and PKCE material where supported.
- `DropboxOAuthService.complete(state: string, code: string): Promise<StorageConnectionView>` rechecks church role, redirect/state and account identity, encrypts refresh credentials and records a connection epoch.
- `DropboxSyncService.catchUp(connectionId: string): Promise<void>` imports provider changes through the same committed mutation/change-log boundary as Task 3, with provider revision provenance.
- `/v1/orgs/:orgId/storage/dropbox/connect`, `/disconnect`, `/reconnect`; provider OAuth callback and verified webhook endpoints are separate from JWT file routes. Add authenticated streaming chunk/session endpoints in `dropbox.controller.ts`, each checked against live church roles and the stored upload session.

- [ ] Write tests for OAuth CSRF/state replay, role revoked during callback, token refresh rotation, App Folder bounds, revoked credentials, account mismatch on reconnect and redaction. Test an absent connector never silently uses B2.
- [ ] Write tests for Dropbox `429`/`Retry-After`, full provider storage, provider revision conflict, rename/delete outside Kairo, cursor reset, duplicate webhook and Dropbox hash versus SHA-256 mismatch. Test connector epoch invalidates jobs after disconnect.
- [ ] Run `bun run --cwd server test -- --runInBand dropbox`; confirm failures before implementing.
- [ ] Implement the qualified server adapter/streaming flow with 8 MiB upload chunks, bounded memory and disconnect-aware cancellation. Reuse provider-session reservations/concurrency while showing Dropbox capacity separately; no B2 allowance consumption for Dropbox originals.
- [ ] Implement connect/reconnect/disconnect UI and background cursor/webhook catch-up, with scheduled recovery when webhook delivery is missed. Preserve files on disconnect. Keep tokens encrypted server-side and never place them in direct client download links.
- [ ] Rerun Dropbox unit/e2e checks, server build/CF typecheck, website build and desktop typecheck. Verify authorised sandbox accounts end-to-end only when available; record any missing live qualification honestly. Complete provider production approval before enabling public rollout. Commit.

## Task 7: Migration, lifecycle integration and launch qualification

**Files:**
- Create: `server/src/storage/storage-migration.service.ts`, `storage-migration.spec.ts`, `storage-lifecycle.spec.ts`
- Modify: storage controllers/jobs, `server/src/account/account.service.ts`, church lifecycle paths in `server/src/orgs/orgs.service.ts`
- Modify: `website/src/app/dashboard/storage/page.tsx`, admin Storage page
- Create: `docs/cloud-storage-operations.md`
- Create: `server/test/storage-load.mjs`

**Interfaces:**
- `StorageMigrationService.start(orgId: string, actorId: string, destinationConnectionId: string): Promise<{ jobId: string }>` is an audited admin request with explicit destination-capacity checks.
- `StorageMigrationService.status(orgId: string, jobId: string): Promise<StorageMigrationStatus>`; define status with copy/verify/cutover/failure counts, expected temporary bytes and source cleanup awaiting approval.
- Add authenticated migration status/start/cutover/source-cleanup endpoints; use a revision/epoch barrier during cutover and pause writes briefly. Existing transfers must finish or be invalidated before activation.

- [ ] Write tests for insufficient destination quota, partial migration retry, mid-copy edits, disconnect, rollback before cutover and source retention until explicit cleanup. Test account deletion during pending uploads/migration with credentials retained only long enough for authorised cleanup.
- [ ] Run `bun run --cwd server test -- --runInBand storage-migration storage-lifecycle`; verify intended failures.
- [ ] Implement copy/verify/cutover, source retention, account/church deletion cleanup and export of cloud metadata. Block removal of the sole connector owner without reconnection/ownership resolution where required by the qualified provider model.
- [ ] Add operating runbook: deployment secrets, provider configuration validation, quota changes/downgrades, allowance overrides, key rotation, reconciliation, upload kill switches, orphan cleanup, connector revocation, lost-device recovery and support escalation without unrestricted media access.
- [ ] Implement a configurable load harness for paginated folders, upload admission/finalisation, backlog catch-up and reconnect bursts using fake file content/provider fixtures. Record test concurrency, byte volumes, latency/error results and bottlenecks; paid large-volume provider tests require separate authorisation. Do not claim 100,000 churches from a small smoke test.
- [ ] Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`; run server unit/e2e/build/CF checks and website build from prior tasks. Repeat only for changed code/failures. Record provider qualification gaps and measured cost assumptions.
- [ ] Commit the verified phase. Roll out to an explicit allowlist first; widening rollout is a separate product/deployment decision. No release or paid resource provisioning is part of this plan-writing request.

## Completion checklist for implementation

- [ ] Platform admins can configure every policy in the spec and inspect effective per-church values.
- [ ] Churches can select managed storage or connect Dropbox and manage files/folders from the dashboard.
- [ ] Selected files sync safely to desktop and remain usable offline.
- [ ] Quota, disconnect, conflict, deletion and migration states are clear and recoverable.
- [ ] Actual provider/billing caveats and live qualification results are documented.
- [ ] No provider credentials leak, no cross-church file access and no cloud dependency in local presentation execution.

## Plan self-review

Coverage checked against the companion spec: common policy/accounting (Task 2), metadata/B2/lifecycle jobs (Task 3), dashboards (Task 4), offline filesystem and presentation protection (Task 5), Dropbox (Task 6), migration/account deletion/operations (Task 7). Task 1 qualifies capabilities before provider assumptions become implementation commitments. This document has not executed those tests or provisioned either provider.
