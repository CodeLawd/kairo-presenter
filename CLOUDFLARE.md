# Cloudflare deployment

The website runs on Cloudflare Workers with OpenNext; the NestJS API runs in a Cloudflare Container. MongoDB remains on Atlas. Production domains are `kairopresenter.com` and `api.kairopresenter.com`.

## Bun

Use Bun **1.4.2** for installs and scripts in the repository root, `website/`, and `server/`. Each package has its own `bun.lock` and the same `packageManager` value. Node.js is still required for Next tooling, the Nest runtime and Electron tooling. Use `bun run test` to run the existing Node test suite; `bun test` invokes a different runner.

```sh
bun install --frozen-lockfile
bun install --cwd website --frozen-lockfile
bun install --cwd server --frozen-lockfile
```

The old error was a package-manager mismatch: Cloudflare selected Yarn while the root manifest required npm. Bun lockfiles and consistent manifests replace both. Do not run the framework migration wizard again; the adapter and Wrangler configuration are committed.

## Cloudflare dashboard: two Workers Builds projects

Connect the same repository twice under **Workers & Pages → Workers**, using the following production settings. Use a Workers Paid account with Containers enabled. The domain must be in the account so Wrangler can attach custom domains.

| Setting | Website | API |
| --- | --- | --- |
| Worker name | `kairo-presenter` | `kairo-api` |
| Root directory | `website` | `server` |
| Build command | `bun run cf:build` | `bun run build` |
| Deploy command | `bun run cf:deploy` | `bun run cf:deploy` |
| Bun version | `1.4.2` | `1.4.2` |
| Node version | `22` | `22` |

Set build variables `BUN_VERSION=1.4.2` and `NODE_VERSION=22`. Automatic installs should detect `bun.lock`. If using a custom install command, use `bun install --frozen-lockfile`. Do not set `.next` as a static output directory: OpenNext emits `.open-next/worker.js` and `.open-next/assets`, already referenced by `website/wrangler.jsonc`.

Workers Builds can build the API Dockerfile remotely. Its build context is the repository root because shared contracts live in `src/lib/cloud`. Local API deployment additionally requires Docker running.

## API secrets and runtime variables

Set these in **kairo-api → Settings → Variables and Secrets**, before sending API traffic:

- `MONGO_URL`: existing MongoDB Atlas connection string. Ensure Atlas network access permits the container's outbound connection.
- `JWT_SECRET`: retain the existing production value to preserve sessions; at least 32 characters.
- `VAULT_ENCRYPTION_KEY`: **retain the existing value** so stored organization API keys can still be decrypted.

Optional secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `DOWNLOAD_INGEST_KEY`. Optional variables: `BREVO_SENDER_EMAIL` (a verified sender), `SUPERADMIN_EMAILS`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `SERMON_MODEL`, `SERMON_DEEPSEEK_MODEL`, `SERMON_REASONING_EFFORT`.

`PUBLIC_WEB_URL=https://kairopresenter.com`, `WEB_ORIGIN=https://kairopresenter.com`, and `BREVO_SENDER_NAME=Kairo` are already in Wrangler configuration. If Google sign-in is enabled, register `https://kairopresenter.com/v1/auth/google/callback` as the authorized redirect URI; leave `GOOGLE_CALLBACK_URL` unset to derive this automatically.

Secrets are allowlisted and forwarded to the container at startup. Restart/redeploy the container after changing credentials so the running Node process receives them. Never put credentials in Docker build arguments, Wrangler vars, committed env files, or client-side `NEXT_PUBLIC_*` variables.

The gateway routes to one API instance and retains it for 30 minutes without requests, allowing background recap generation to finish. Its database-backed recovery runs again when the API wakes. A continuously running queue would require a different lifecycle policy. First deployment/cold starts can return 503 while the container starts; the response includes Retry-After.

## Website configuration

Production runtime vars are already set in `website/wrangler.jsonc`:

- `SITE_URL=https://kairopresenter.com`
- `SITE_INDEXING=true`
- `API_PROXY_TARGET=https://api.kairopresenter.com`

Also set these as **build variables** so static pages and SEO files use the production values. Store `DOWNLOAD_INGEST_KEY` as a website Worker secret with the same value as the API when download tracking is enabled.

The browser continues to call `/v1/*` on the website origin. That proxy preserves refresh cookies and OAuth redirects. Do not replace browser requests with cross-origin API requests.

The OpenNext bundle resolves takumi-pdf through its workerd entrypoint, which imports its WebAssembly module. Keep the PDF package external during Next's build so OpenNext can select this entrypoint. Image optimization uses the IMAGES binding. No R2 cache is configured: the marketing pages are static and account/API routes are uncached. Add shared caching before introducing ISR/revalidation features.

For Cloudflare non-production builds, set **SITE_INDEXING=false at build time and runtime**. Use `bunx opennextjs-cloudflare upload` as the website's non-production deploy command after `bun run cf:build`; do not use the production deploy command for feature branches. API Worker version uploads do not deploy a new container image or produce a complete preview; use a separate staging Worker/config for backend previews.

## Local commands

```sh
# Website: production bundle, then local Workers runtime
cd website
bun run cf:build
bunx opennextjs-cloudflare preview

# API: from server/, with Docker running and a local .dev.vars
cd ../server
bun run cf:dev
```

Copy `.dev.vars.example` to `.dev.vars` as needed. Those files are gitignored. Build deployment artifacts in a clean checkout: OpenNext can embed local `.env` values in the Worker bundle.

For manual production deployment, authenticate with `bunx wrangler login` in each package, then run `bun run deploy` in `website/` and `bun run cf:deploy` in `server/` (Docker required for the API). Deploy the API and verify it before switching the website domain. Wrangler custom-domain routes replace the website's current origin; make the cutover when ready.

## Cutover checks

1. `https://api.kairopresenter.com/v1/health` must return `status: ok` and `database: up`.
2. `https://kairopresenter.com/v1/health` must return the same result through the same-origin proxy.
3. Sign in, reload, refresh the session, sign out, and test Google sign-in if enabled.
4. Upload a sermon, wait for a recap, open its shared link, and download its PDF. Test installer downloads and tracking.
5. Inspect `/robots.txt`, `/sitemap.xml`, canonical URLs, and the OG image. Submit the sitemap to Search Console.
6. Set GitHub repository variables `PROD_API_URL=https://api.kairopresenter.com` and `PROD_WEB_URL=https://kairopresenter.com` for future desktop releases. Keep any old API hostname working for already-installed apps until they update.
7. Retain the Vercel deployment until the checks pass, then remove its domain and deployment integration.

References: [OpenNext setup](https://opennext.js.org/cloudflare/get-started), [Cloudflare Bun/build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), [Container deployment](https://developers.cloudflare.com/containers/guides/deploy/).
