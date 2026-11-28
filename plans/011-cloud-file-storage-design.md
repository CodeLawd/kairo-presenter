# Kairo cloud file storage design

Status: proposed; documentation only. Date: 2026-11-15.

## Outcome

Churches manage images, videos, audio and documents from Kairo desktop and the church dashboard. Files and folders sync to selected computers and remain available locally without internet. Offer two storage destinations:

1. **Kairo Storage:** Kairo-owned Backblaze B2 with a platform-admin-configured allowance per church.
2. **Connected Dropbox:** a church connects its own Dropbox account; its Dropbox plan supplies the capacity.

Kairo retains accounts, permissions, folder metadata and sync history in its existing NestJS/MongoDB backend. Backblaze or Dropbox holds file contents. These providers do not replace Kairo's sync engine. Remote presentation control is a separate project.

## Existing foundations

- Desktop: Electron/React/TypeScript, local workspace in `src/main/services/workspace/index.ts`, media service in `src/main/services/media/index.ts`, main-process cloud session/API client and encrypted credential support.
- Backend: NestJS/Mongoose, church membership roles `viewer`, `operator`, `admin`, `owner`, plus separate platform roles `admin` and `superadmin`.
- Website: Next.js church dashboard and platform admin console.
- Existing retryable sermon uploads are a useful pattern, not an existing general-purpose file sync implementation.
- Graphify was attempted during discovery; this repository is not in its available index. Current local files were used instead. The working tree was clean before writing these documents.

## Product boundaries

- Launch supports one active writable storage connection per church. Files retain their original connection ID so later migrations do not reinterpret old locations.
- Both providers expose one Kairo file-browser experience. Media sync ships first; structured songs/setlists/themes remain in existing stores until their own record-sync work ships.
- Share only the Kairo workspace's Media directory and explicitly imported files. Do not scan or upload arbitrary computer folders.
- Automatically create shared folder structure on other devices under each device's own workspace root. Sync empty folders as metadata too.
- Users choose all shared media or selected folders for offline download. Service-only downloads follow when all presentation references have stable cloud asset IDs.
- Every local edit saves first. Cloud work runs in the background and never blocks live rendering, scripture detection or audio capture.
- Remote changes never replace a file actively being presented. Finish downloads to a staging location, validate them and switch references safely afterwards.
- Do not automatically compress, transcode, remove cloud originals or expire active files at launch.

## Roles and authority

| Actor | Permissions |
|---|---|
| Church viewer | Browse, preview and download files in their church |
| Church operator | Viewer actions plus upload, create/rename/move folders and move files to Trash |
| Church admin/owner | Operator actions plus restore/purge Trash, storage settings, connect/reconnect Dropbox and request migration |
| Kairo platform admin | Inspect usage/health, update policy defaults and per-church overrides; no general access to file contents |
| Kairo superadmin | Admin actions plus enable providers and select validated infrastructure configurations |

Use live membership checks on server operations, including downloads and upload finalisation. Platform policy access does not implicitly grant church media access. Audit policy edits, connector changes, purges and migrations with actor, church, time, before/after and reason. Do not share passwords or expose provider credentials to the renderer.

## Platform admin: Storage section

Add `/admin/storage` for policy, account usage, health and estimated costs; add a Storage panel to each existing church detail page for overrides. All numeric sizes are stored as integer bytes; the UI uses decimal GB (1 GB = 1,000,000,000 bytes).

The following are proposed launch defaults, not previously accepted commercial commitments:

| Setting | Starting value | Behaviour |
|---|---|---|
| New church default provider | Kairo Storage, if enabled | No connection until enabled; existing local files are not uploaded without church opt-in |
| Default managed allowance | 5 GB/church | Editable globally; optional per-church byte override |
| Subscription allowance mapping | Empty | Admin can assign allowances to existing plan IDs; absent mapping uses default |
| Allowed providers | B2 and Dropbox after validation | Separate provider toggles; disabling stops new connections/uploads and preserves downloads |
| Maximum single file | 2 GB | Configurable; further bounded by effective allowance and verified provider capabilities |
| Allowed file classes | Images, videos, audio, PDF, presentation documents | Explicit MIME/extension allowlist; validate signatures, not extension alone; no arbitrary executables/HTML |
| Active uploads per church | 3 | Server-enforced active-session cap, with a configurable platform cap (initially 100) |
| Usage warning thresholds | 80%, 95%, 100% | Notify once per threshold crossing; 100% blocks additions |
| Trash retention | 30 days | Trashed originals still consume allowance until physical purge succeeds |
| Retained replaced versions | 0 old versions | References in an active presentation may temporarily retain a version; account for all physical bytes |
| Automatic active-file expiry | Off | Optional 30/60/90-day service-upload policy later, only with church opt-in and a safe preview |
| Stalled upload reservation expiry | 24 hours | Abort unfinished uploads and reconcile actual provider state before releasing committed usage |
| Account budget alerts | $25, $50, $100/month estimates | Editable thresholds; alerts are estimates, not guaranteed invoice caps |
| Managed stored-byte ceiling | 1 TB initially | Configurable platform safety ceiling, reserved atomically along with church allowance |
| Managed download protection | 3x current monthly average storage estimate | Alert when approaching estimated B2 free egress; optional configurable per-church download-byte cap, off by default |
| Emergency upload pause | Off | Global, provider-specific and church-specific; does not delete content or disable local presenting |

Effective managed allowance: explicit church override, else mapped subscription allowance, else global default. Overrides can expire at a chosen UTC instant. Show inherited value, effective value and why. Changes apply immediately to future admissions; existing reservations must be rechecked at finalisation. Quota reductions preserve files, mark the church over quota and stop additions. Replacement must reserve full new bytes while the old original remains retained. Returning to inherited policy is an explicit action. Apply global policy to all inheriting churches and preview the number that would become over quota before saving.

The admin console can configure non-secret B2 connection metadata (region/endpoint, bucket alias and prefix) and see connection-test status. Credentials live in deployment secrets, supplied by the deployment operator; the UI never displays secret values. Validate endpoints against supported provider hosts, not arbitrary URLs. Do not permit editing a populated connection's bucket in place: create a new connection and use migration instead. Bucket/account credentials and storage allowance policy are different settings.

Church admins cannot increase their own Kairo allowance. Dropbox capacity comes from Dropbox; show provider-used/provider-total separately from Kairo-folder usage. A platform optional app-folder cap can limit Kairo uploads to Dropbox, but is not a grant of additional Dropbox space. Infrastructure/metadata costs remain with Kairo.

## File organisation and data model

Folder and file display names are metadata, not raw storage keys. Use stable UUIDs for cloud identities; keep folders separate from provider layout. A B2 key is `churches/{orgId}/blobs/{blobId}`. Physical locations are server-selected and never trusted from caller input.

Collections:

- `storage_policies`: one versioned global policy plus plan mappings; optimistic concurrency for admin edits.
- `church_storage`: active connection, override, policy revision, logical/physical/reserved bytes and upload-paused flags. Physical and reserved counters are authoritative for B2 admissions.
- `storage_connections`: provider, church, state, non-secret configuration and encrypted OAuth credentials where applicable. Each OAuth token change has a connection epoch for invalidating queued jobs.
- `cloud_folders`: church, UUID, parent ID, name, revision and deletion state. Enforce unique normalised sibling names and prevent ancestor cycles.
- `cloud_files`: church, UUID, parent, display name, blob reference, revision, media type and Trash state. Stable ID survives moves/renames.
- `cloud_blobs`: church, provider connection, immutable object/version identity, SHA-256, actual byte count, verification status and reference count. No cross-church deduplication. Count each physical blob once, including Trash and retained versions; reference count alone is not proof that deletion is safe.
- `storage_uploads`: idempotency key, expected size/hash, provider upload identity, reserved bytes, status and expiry. Unique `(orgId, idempotencyKey)`.
- `storage_changes`: ordered church-scoped changes, including tombstones; indexed `(orgId, sequence)`. Sequence allocation and committed changes must be atomic; cursor pagination must not skip late commits. Prefer serialized per-church transactional mutation ordering, with replica-set support verified before execution.
- `storage_jobs`: durable leases for cleanup, reconciliation, connector refresh and migration. Persist job state in MongoDB and run bounded workers in the existing backend; do not rely on one process's timers for correctness.
- `storage_audit`: append-only privileged-action history; never tokens or signed URLs.

All queries are church-scoped and folder listings are paginated. Maintain counters from committed mutations; reconcile with provider inventory periodically. Do not scan every church or list an entire bucket on every sync. Desktop queue/mappings live in a dedicated SQLite database, not inside the synced Media folder.

## Backblaze transfer flow

1. Client hashes a file in a background worker and asks the API to begin an upload with size/hash, file ID, base revision and idempotency key.
2. Server checks membership, policy, file type, concurrency and quota. Deduplicate only against a verified ready blob in the same church. Otherwise atomically reserve full expected bytes against church and platform limits.
3. Server creates an immutable destination and short-lived upload capability. Client transfers directly to B2 with resumable multipart uploads; provider master credentials never leave the server. Restrict upload capabilities to the selected object/parts; verify supported signing and checksums in the provider qualification task.
4. Client requests finalisation. Server verifies actual size, content type/signature and SHA-256 using a bounded background verifier reading the stored object. Never treat a client-provided checksum or user object metadata as proof of content. State stays `verifying` and is not downloadable until verification succeeds.
5. Commit the file revision, counters and change entry transactionally; retrying completion returns the same result. Reject revision conflicts while preserving the upload as a conflict copy the operator can review.
6. On mismatch or cancellation, quarantine/abort and enqueue physical deletion. Keep actual bytes accounted until deletion is confirmed. Reconcile uploads that complete after their reservation expires. Outstanding signed capabilities have bounded lifetimes; quotas are admission controls, not absolute protection against malicious oversize uploads, so provider-side controls, actual-byte monitoring and rapid cleanup are required.

Download requests check current church membership and issue short-lived, object-specific URLs. Signed URLs are bearer capabilities and remain usable until expiry; choose five-minute expiry and do not promise immediate revocation. Cache files locally and avoid repeated downloads. Track issued and observed bytes separately; issuing a URL does not establish that its full file was downloaded. Invoice-based/account provider metrics remain the billing source.

## Dropbox connection and transfers

- One church admin/owner connects a church-controlled Dropbox account through OAuth. Never ask for a Dropbox password or require users to create developer apps. Register one Kairo developer app and complete Dropbox production approval before general rollout.
- Start with App Folder scope for Kairo-managed content only. Existing arbitrary Dropbox folders require a later, separately explained Full Dropbox/shared-folder integration. Do not imply App Folder can browse a user's whole account.
- The connection belongs to the church record, not to an employee's browser session. Prefer a church-controlled account and show who connected it. If that person leaves or the account is revoked, mark reconnection required; preserve downloaded files and explain the state.
- Refresh tokens are encrypted server-side using the existing vault encryption pattern. Do not repurpose the retired church API-key editing endpoints. All church members use Kairo permissions; never distribute the connector's broad access token to every device.
- Use server-mediated, authenticated bounded streaming upload/download chunks for the first release; cap upload chunks at 8 MiB and use provider upload sessions for large files. Use Range downloads where supported. Keep transfer concurrency bounded and outside live presentation work. Budget backend bandwidth/compute explicitly; Dropbox API access being free does not make this proxy free.
- Qualify the exact App Folder multi-user access model and provider terms before shipping. If the planned church-wide mediated access is not permitted, do not ship this flow; revise to a supported team/shared-folder authorisation model.
- Maintain a dedicated Kairo subtree identified by provider IDs. Use provider revision checks, list-folder cursors and validated webhooks plus periodic catch-up. Dropbox's content hash is not SHA-256; compute/store it separately and do not equate the two.
- For edits outside Kairo, import changes and deletions with revision history. A moved/renamed item keeps its cloud file ID. A webhook is a notification to fetch changes, not a trusted file mutation.
- Handle `429` with `Retry-After`, full Dropbox storage, expired/revoked credentials and conflicting provider edits. Show actionable states rather than retrying forever without visibility.
- Dropbox usage does not consume the B2 allowance. Do not duplicate every Dropbox file in B2, and do not silently fall back to paid managed storage when Dropbox fails.
- Disconnect stops refresh/sync, invalidates pending jobs and removes stored tokens. Leave Dropbox content and local downloads intact; reconnect requires validation of the account and folder identity.

## Dashboard and desktop experience

Church dashboard: `/dashboard/files` with folder tree/list, breadcrumbs, search, sorting, upload progress, previews, create/rename/move, download, Trash and restore. Paginate contents; unsupported formats offer download rather than execution. Show queued/verifying/ready/error distinctly. Preview untrusted documents in a sandboxed path, not as same-origin executable content.

`/dashboard/storage`: provider, Kairo usage/allowance or Dropbox account capacity, connection health, reconnect/disconnect, local-versus-cloud explanation, and migration action. Provide an explicit optional upload/import step for existing desktop media.

Desktop: add Cloud Storage settings and shared-library actions through existing main-process IPC. Show offline selection, pause/resume transfers, progress, last successful sync, file errors, conflicts and missing dependencies. Never expose raw provider keys. Show readiness only when every selected dependency is verified on disk.

## Offline, deletion and conflict behaviour

- Persistent outbox, file-to-cloud-ID mappings, resumable sessions, device ID and cursor per church/connection; idempotent commands survive restart.
- Reject path traversal, unsafe filenames/symlinks and case-colliding sibling names across macOS/Windows/Linux. Download into a safe temporary file then atomically replace; suppress watcher echo loops.
- Cloud revision conflicts create reviewable copies; do not silently select the most recent device clock. Base revisions come from the server.
- First sync is an explicit import/merge, never a destructive mirror. Church switch pauses and isolates that church's outbox/downloads; account sign-out prevents further cloud requests.
- Moving to Trash emits a tombstone. Desktop unlinks shared-library references but preserves an active presentation's file and keeps a recoverable local copy until safe cleanup. Removing an offline download never deletes the cloud file. Purging cloud content is distinct from evicting a local download.
- Retain change history for 90 days initially. Older cursors require a snapshot resync that first preserves unsent local edits; missing snapshot items are not treated as new local uploads.
- A migration is explicit: copy to destination, verify every file, show destination readiness, then cut over under a short write pause. Resume failed jobs; stop if destination lacks capacity. Keep source intact until church admin confirms cleanup. Account for temporary double storage and outstanding reservations. No automatic deletion on provider switch.
- Church/account deletion must cancel jobs, revoke connector access and remove owned B2 content, including unfinished uploads and Trash. For connected Dropbox, leave files by default and disclose that behaviour; an explicit approved purge may remove only Kairo-managed content. Keep credentials until any requested cleanup completes, then erase them.

## Delivery and commercial controls

Ship common policy/metadata foundation, then managed B2 file management, then desktop sync, then Dropbox connector, then provider migration. Each phase has a separate rollout flag. Offer 5 GB free as an editable proposal; product billing/paid storage sales are a separate integration, not invented subscription tiers in this project.

Default free-tier accounting includes originals, Trash, retained versions, and generated previews. Incomplete uploads consume reservations and reconciled physical usage. Separate logical displayed size from billable provider consumption; do not promise that deduplication or expiry eliminates all provider charges.

Benchmark realistic uploads/downloads, Sunday reconnect bursts and many small folders. Before broad rollout verify B2 bucket/key limits, provider quotas, Mongo transaction support, Dropbox production approval, legal integration terms and expected region latency. Do not claim 100,000-church readiness without measured results.

## Acceptance scenarios

1. Admin changes the default to 5 GB and gives one church 20 GB; church operators cannot change either setting.
2. Two uploads race for the last space; only the admissible reservation succeeds. A retry neither double-counts usage nor creates a second file.
3. Lowering allowance below existing usage leaves files readable and blocks additions, with a clear explanation.
4. A church creates an empty folder and uploads image/video/audio on the website; a second device recreates the folder and verifies every selected download.
5. Rename/move does not re-upload bytes; duplicate content within one church can reuse a verified blob; another church cannot probe or access it.
6. An interrupted large upload resumes after app restart; a cancelled or malformed upload eventually releases space only after safe cleanup.
7. Offline conflicting edits, remote deletion, case collisions and a 90-day-old cursor preserve unsent local work.
8. A Dropbox church sees its Dropbox capacity, survives rate limits and reconnects after revocation without creating B2 charges.
9. Sign-out, role revocation and church switching cannot expose another church's queue, files, tokens or sync stream.
10. Remote file changes during presentation cannot stop currently playing video/audio or replace the displayed asset unexpectedly.

## Pricing and provider references

Verified during this discussion on 2026-11-15; recheck before implementation and billing launch.

- [B2 pricing](https://www.backblaze.com/cloud-storage/pricing): first 10 GB free per account; advertised $6.95/TB/month, free egress up to 3x average stored data, then $0.01/GB outside eligible partner routes. No minimum storage duration. Do not hardcode rates into quota enforcement.
- [Dropbox developer FAQ](https://www.dropbox.com/developers/support): no developer API fee; free and paid users may connect; production approval required for public rollout.
- [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth): App Folder versus Full Dropbox, scoped authorisation.
- [Dropbox performance](https://docs.dropboxapi.com/dropbox-api/docs/performance): rate limits, upload sessions and some plan-dependent data transport limits.
- [Dropbox plans](https://www.dropbox.com/plans?billing=yearly): church pays its provider plan; capacity and team access depend on that plan.
