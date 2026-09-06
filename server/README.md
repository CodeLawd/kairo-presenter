# Kairo API

NestJS + MongoDB. Serves the desktop app and the web app from one API.

## Run it

```bash
cp .env.example .env      # fill in what you have; unset optionals stay off
brew services start mongodb-community   # or however you run mongod locally
npm install
npm run start:dev
```

`.env` is read at boot for local development. Real environment variables always
win over it, so nothing in that file can shadow what Render injects.

`GET /v1/health` reports the process and the database.

Nothing here needs a credential to run. With no `BREVO_API_KEY` the mailer logs
each message — link included — instead of sending it; with no
`GOOGLE_CLIENT_ID` Google sign-in is simply off. That is deliberate: a new
developer gets a working API, and a full signup-and-verify loop, from
`MONGO_URL` and `JWT_SECRET` alone.

## Test

```bash
npm test          # unit
npm run test:e2e  # full app against mongodb-memory-server — no local mongod needed
```

The e2e suite boots the real module graph: real guards, real pipes, real
argon2. The behaviours worth testing here — org scoping, refresh rotation,
reuse detection — only exist as the interaction between those pieces, so
mocking them out would produce a suite that passes while the API leaks data.

## Layout

| Path                   | What                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `src/config`           | Environment contract, validated once at boot                     |
| `src/auth`             | Signup, sign-in, refresh rotation, email tokens                  |
| `src/users`            | Accounts                                                         |
| `src/orgs`             | Churches, memberships, roles, encrypted API-key vault            |
| `src/mail`             | React Email templates + Brevo transport (logs when unconfigured) |
| `src/components/email` | Vendored [emailcn](https://www.emailcn.run) blocks               |
| `src/common`           | Guards, decorators                                               |

## Deploying to Render

Build `npm ci && npm run build`, start `npm start`. Because `tsconfig.json`
includes the shared contracts from the desktop repo (`../src/lib/cloud`),
TypeScript roots the output at the repo root — the entry point is
`dist/server/src/main.js`, which is what `npm start` runs.

Set every variable from `.env.example` in the Render dashboard. `MONGO_URL`
points at Atlas; `WEB_ORIGIN` and `PUBLIC_WEB_URL` at the deployed web app.

## Auth model

- **Access token** — JWT, 15 min, carries `sub / orgId / role / deviceId`. Never
  read from the database on the hot path.
- **Refresh token** — opaque 32 random bytes, 60 days, rotating, stored only as
  a SHA-256 hash. Replaying a consumed token revokes the whole device chain.
- **Web** receives the refresh token as an `HttpOnly` cookie scoped to
  `/v1/auth`; **desktop** receives it in the body and stores it encrypted.
  Clients identify themselves with `X-PA-Client: web | desktop`.
- **Org scoping** is re-read from the database on every guarded request, never
  trusted from the token — the `:orgId` in a path is whatever the caller typed.
- **Org secrets vault** (`GET/PUT /v1/orgs/:orgId/secrets`) stores booth API
  keys encrypted at rest with `VAULT_ENCRYPTION_KEY` (AES-256-GCM). The API
  decrypts for authenticated org members so desktop can hydrate another
  machine; Mongo never holds plaintext. Finer role gating is deferred.

## Email

Templates are React components rendered to HTML at send time, built on
[emailcn](https://www.emailcn.run) blocks (a shadcn-style registry for React
Email). They are vendored into `src/components/email` — owned code, not a
dependency — and pulled with:

```bash
npx shadcn@latest add @emailcn/react-email/<block>
```

`src/mail/templates` composes those blocks into the actual messages, each
shipping an HTML and a plain-text part.

Delivery is **Brevo**, over its HTTPS transactional API rather than SMTP:
managed hosts throttle or block outbound SMTP, and an HTTP call returns a
status and an error body worth logging instead of a socket timeout. Set
`BREVO_API_KEY` and a `BREVO_SENDER_EMAIL` that Brevo has verified as a sender —
an unverified sender is rejected on every send.

A failed send is logged, never thrown. The account, invite or reset that
triggered the email already exists; failing that request because a mail
provider was slow would tell the caller nothing happened when everything did.

Jest runs with `--experimental-vm-modules` because `@react-email/render`
dynamically imports `react-dom/server`, which the CJS test runtime cannot
otherwise load.
