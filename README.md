# Kairo

Electron desktop app for church presentation: live transcription, scripture
detection and lookup, lyrics, documents and backgrounds — drawn full screen on a
projector connected to the computer, no other software required.

ProPresenter and NDI are integrations: Kairo can push to ProPresenter's library,
messages and stage layers, and send its rendered slide as an NDI source, alongside
(or instead of) its own screens.

## Development

```bash
npm install        # install deps (npm, not yarn)
npm run dev        # dev mode with hot reload
npm run build      # production build → out/
npm run lint       # ESLint on .ts/.tsx
npm run typecheck  # tsc check (node + web)
npm test           # renderer/shared tests (plain Node)
npm run test:main  # main-process tests (run under Electron's Node ABI)
```

`npm run test:main` runs through the Electron binary because `better-sqlite3` is
rebuilt for Electron's ABI; the same files fail to load under plain `node`.

## Scripture: API.Bible and the offline cache

Bundled public-domain translations (KJV, WEB, ASV, …) ship in `resources/bible.db`
and never expire. Copyrighted translations (NKJV, NIV, NLT, …) come from API.Bible.

### API key setup

1. Request a key at <https://scripture.api.bible> and enable the translations you
   are licensed to use.
2. In the app: **Settings → API Keys → Bible (API.Bible)**, paste the key, save.
3. **Settings → Scripture → Default Bible Translation** lists every translation
   your key can reach; unavailable ones are disabled.

The key is stored by the main process and is never exposed to the renderer.

### How caching works

- Every API.Bible passage the app fetches is cached locally, encrypted with
  AES-256-GCM. The data key is protected by the OS keychain through Electron
  `safeStorage`; if the OS offers no encryption, nothing is cached and the app
  stays online-only.
- The cache lives in a database under Electron's `userData` directory, separate
  from the bundled `bible.db`. Its path, key, and ciphertext never reach the
  renderer, and there is no export, bulk copy, or print path for licensed text.
- Repeating a search within 30 days is served from the cache with no content
  request to API.Bible.

### The 30-day refresh rule

API.Bible requires cached content to be refreshed at least every 30 days. Cached
verses at or past that age are **not displayed**; the app asks for a refresh
instead of showing expired text. Refreshing replaces a chapter only after the new
response parses successfully — a failed refresh never extends the expiry.

### Offline Bibles panel

**Settings → Scripture → Offline Bibles** lists every API translation the cache
knows about, with its status (not downloaded, partial, downloading, paused,
downloaded, refresh required, no longer licensed, failed), chapter and verse
counts, expiry date, and the publisher's copyright statement.

- **Download** fetches the whole translation one chapter at a time, at most two
  requests in flight, saving progress after every chapter.
- **Pause** stops after the chapters already in flight. **Resume** continues from
  the incomplete chapters — completed ones are never refetched. A download
  interrupted by quitting the app reopens as *paused* on the next launch.
- **Refresh** re-fetches only chapters that reached the 30-day boundary.
- **Remove** deletes the cached text for that translation. The API key and app
  settings are untouched, and the translation can still be searched online.

### Licence approval gate

Whole-translation download stays disabled until the translation's API.Bible plan
and publisher licence are confirmed to permit offline storage in this app. Until
then the panel explains that the licence is unconfirmed and offers no download
button. Passage-level caching (30 days) still applies either way.

There is deliberately no in-app toggle — an operator cannot grant the app a right
the publisher has not. Approved Bible ids are provisioned one of two ways:

- **Per install** — the `scripture.offlineDownloadBibleIds` array in the
  electron-store settings file (its path is logged at startup as
  `electron-store initialized`). Add the API.Bible ids and restart.
- **Per build or deployment** — set `KAIRO_OFFLINE_BIBLE_IDS` to a
  comma-separated list of API.Bible ids before launching the app. Use this when
  a build ships with rights already confirmed.

Both sources are merged. **Public-domain translations need no approval**: any
translation whose API.Bible copyright statement says "public domain" can be
downloaded without being listed.

**Refresh** is gated on the same confirmed licence as download, since it
re-fetches the whole cached translation.

Whenever cached text is served, the app re-checks once per app session that the
key still grants that translation. If API.Bible refuses (401/403), the
translation is marked *no longer licensed*, its cached text is deleted
immediately, and it can no longer be searched. A network failure never revokes
anything, so a fully offline service keeps working.

## Platform rollout status

| OS | Arch | Minimum | Artifacts | Status |
|---|---|---|---|---|
| macOS | arm64 | macOS 11 | DMG + ZIP (ZIP feeds auto-update) | Existing target; final NDI 6 acceptance pending |
| macOS | x64 | macOS 11 | DMG + ZIP | Experimental; native acceptance pending |
| Windows | x64 | Windows 10 | signed NSIS installer | Experimental; native acceptance pending |
| Ubuntu | x64 | 22.04 | AppImage + deb | Experimental; native acceptance pending |

Windows ARM64, Linux ARM64, Flatpak/Snap, and a universal macOS build are not
supported. The planned Linux support contract means Ubuntu 22.04/24.04 x64; AppImage may work elsewhere
but that is best-effort and untested.

### Per-platform notes

- **NDI®**: release candidates bundle their runtime and must pass native discovery,
  send, and shutdown acceptance before that target is declared supported.
  NDI® is a registered trademark of Vizrt NDI AB. See
  <https://ndi.video> for NDI tools and news.
- **Document import**: macOS uses installed PowerPoint / WPS / Keynote /
  LibreOffice; Windows uses PowerPoint / WPS / LibreOffice via their
  registered install locations; Linux uses LibreOffice via PATH or a
  registered `.desktop` launcher. Without a supported app, PowerPoint import
  reports “unavailable” — export the deck to PDF and import that instead.
- **Microphone**: capture uses the browser audio stack; the OS permission
  prompt must be accepted. Denying it disables transcription until the
  permission is granted and the source is retried.
- **Sign-in persistence on Linux**: credentials persist only when a
  Secret-Service-compatible keyring (e.g. GNOME Keyring) is available. Without
  one the app still runs fully — it just will not remember the sign-in between
  launches, and says so in the UI.
- **Logs**: renderer/main logs go through electron-log to the per-OS app-data
  directory (the settings-file path logged at startup as `electron-store
  initialized` lives in the same directory). Never paste API keys or tokens
  from logs when reporting issues.
