# Google sign-in setup

Kairo uses a Google **Web application** OAuth client. The desktop app opens the system browser, then receives its own session after the user approves a pairing code.

The code is implemented. Completing setup requires registering the callback in Google Cloud and configuring the API credentials. The credentials reviewed during implementation belonged to the existing **Contentual** client in `contentual-dev`; its callbacks did not include Kairo. No Google Cloud settings were changed.

## 1. Configure a Kairo Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create or select a project dedicated to Kairo. A separate project gives Kairo its own consent-screen branding without changing Contentual.
2. Open **Google Auth Platform**. If prompted, choose **Get started**.
3. In **Branding**, enter **Kairo** as the app name, select a support email, and enter the developer contact email. For production, add your website homepage, privacy policy, and any terms page, and configure the authorized domain.
4. In **Audience**, choose **External** if people outside your Google Workspace organization will use Kairo. During development, keep the app in **Testing** and add each Google account that will test sign-in under **Test users**. Choose **Internal** only for an app restricted to your organization.
5. In **Data Access**, use the basic sign-in scopes `openid`, `email`, and `profile`. Kairo does not need Drive, Calendar, or other Google API permissions.

See Google's [client and consent-screen setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) for the console fields.

## 2. Create the development OAuth client

1. Open **Google Auth Platform → Clients → Create client**.
2. Select **Web application** and name it **Kairo Development**.
3. Under **Authorized redirect URIs**, add this exact value:

   ```text
   http://localhost:3001/v1/auth/google/callback
   ```
 
4. Leave **Authorized JavaScript origins** empty for Kairo's server-side redirect flow.
5. Create the client and securely save its **Client ID** and **Client secret**. Put them in the API environment in the next step; never commit the secret.

The callback uses the **website on port 3001**, whose `/v1` proxy forwards to the API on port 3000. Using the API origin for the callback breaks the website's first-party session cookie. The redirect URI must match exactly, including scheme, port, path, and trailing-slash behavior. See Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

If you deliberately reuse Contentual's client, open that existing Web application client and add Kairo's callback **without removing its existing callbacks**. Its consent screen will retain the project's shared branding. A dedicated Kairo project is recommended before shipping.

## 3. Configure the local environments

If an environment file does not exist, copy its corresponding `.env.example`. If it already exists, edit it in place and preserve its other settings.

In **`server/.env`**, set:

```dotenv
GOOGLE_CLIENT_ID=your-development-client-id
GOOGLE_CLIENT_SECRET=your-development-client-secret
PUBLIC_WEB_URL=http://localhost:3001
GOOGLE_CALLBACK_URL=http://localhost:3001/v1/auth/google/callback
WEB_ORIGIN=http://localhost:3001
```

Keep the API's required `MONGO_URL`, `JWT_SECRET`, and `VAULT_ENCRYPTION_KEY` configured as described in [the API README](README.md). MongoDB must be running. Configure the email provider if you need to test Kairo email confirmation or password reset.

In **`website/.env.local`**, set:

```dotenv
API_PROXY_TARGET=http://localhost:3000
```

In the **repository-root `.env`**, set the desktop URLs:

```dotenv
MAIN_VITE_API_URL=http://localhost:3000
MAIN_VITE_WEB_URL=http://localhost:3001
```

Google credentials belong only in the API environment. Desktop `MAIN_VITE_*` values are embedded at build time, so restart desktop development or rebuild the installers after changing them.

`GOOGLE_CALLBACK_URL` can be omitted: it defaults to `${PUBLIC_WEB_URL}/v1/auth/google/callback`. An explicit value that differs from that URL is rejected when the API starts.

## 4. Start and check the local services

Install dependencies if needed, from the repository root:

```bash
npm install
npm --prefix server install
npm --prefix website install
```

With MongoDB running, start each command in a separate terminal:

```bash
# API: http://localhost:3000
npm --prefix server run start:dev
```

```bash
# Website: http://localhost:3001
npm --prefix website run dev
```

```bash
# Electron desktop app
npm run dev
```

Check the API and the website proxy:

```bash
curl http://localhost:3000/v1/health
curl http://localhost:3001/v1/auth/google/status
```

The status response should contain `"enabled":true`. If either Google credential is absent, the status reports `false` and the website hides the Google button. Restart the API after editing its environment and restart the website after changing its proxy target.

## 5. Verify website and desktop sign-in

1. Open [the local login page](http://localhost:3001/login), choose **Continue with Google**, and select an account listed in Google Cloud's test users.
2. A new Gmail or Workspace account should enter church setup without a Kairo email confirmation step. A new third-party email address receives Kairo's confirmation code. Complete onboarding; an existing account should reach its requested destination.
3. Reload the dashboard to confirm the browser session is restored.
4. In the desktop app, choose **Continue with Google**. The browser opens `/activate?userCode=...`. Sign in and complete onboarding if needed.
5. Confirm the displayed code and computer name match the desktop app, then choose **Approve this computer**. The desktop app should sign in automatically.
6. Repeat with **Decline**, an expired pairing code, desktop cancellation, and cancelled Google consent. These paths should not create a desktop session.

Automatic linking to an existing password account is limited to verified Gmail or Google Workspace addresses for which Google is authoritative. Other existing addresses must use their original sign-in method. Google-only accounts can add a password using password reset. Google explains this distinction in its [identity verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## 6. Configure production

1. Create a separate **Kairo Production** Web application client. Keep local and test callbacks out of the production client, as required by Google's [production-readiness guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
2. Register only your canonical website callback, replacing the example domain:

   ```text
   https://YOUR-WEBSITE-DOMAIN/v1/auth/google/callback
   ```

3. Complete production branding and domain requirements. Publish the app for your intended audience and complete any verification requested by Google Auth Platform before general release.
4. Set these values on the deployed **API**, using the production client's credentials:

   ```dotenv
   NODE_ENV=production
   GOOGLE_CLIENT_ID=your-production-client-id
   GOOGLE_CLIENT_SECRET=your-production-client-secret
   PUBLIC_WEB_URL=https://YOUR-WEBSITE-DOMAIN
   GOOGLE_CALLBACK_URL=https://YOUR-WEBSITE-DOMAIN/v1/auth/google/callback
   WEB_ORIGIN=https://YOUR-WEBSITE-DOMAIN
   ```

5. Set `API_PROXY_TARGET=https://YOUR-API-DOMAIN` on the deployed **website**. The website must proxy `/v1` requests to the API, including callback responses and cookies.
6. Set `MAIN_VITE_API_URL=https://YOUR-API-DOMAIN` and `MAIN_VITE_WEB_URL=https://YOUR-WEBSITE-DOMAIN` before building the **desktop installers**.
7. Restart or redeploy the API and website, rebuild the desktop app, and repeat the website and pairing checks above against production.

Use the same canonical website origin everywhere. `www` and apex domains are different origins; deployment preview URLs need their own configuration and should use a development client.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Google button is missing | Check `/v1/auth/google/status` through the website. Both API credentials must be set, then the API restarted. |
| Status endpoint returns a proxy error | Confirm the API is running and the website's `API_PROXY_TARGET` points to it. |
| Google reports `redirect_uri_mismatch` | Register the exact callback from `PUBLIC_WEB_URL`, including `/v1/auth/google/callback`. Do not use the API host or Contentual's callback path. |
| API rejects the callback configuration | Set `GOOGLE_CALLBACK_URL` to `${PUBLIC_WEB_URL}/v1/auth/google/callback`, or omit it. |
| Google reports `invalid_client` | Confirm the client ID and secret belong to the same Web application client and deployment environment. |
| Google blocks a test account | Add it to **Audience → Test users**, or check whether the app is restricted to an internal organization. |
| Consent expires or returns a state error | Start again from the Google button in the same browser. State expires after ten minutes; do not replay or manually open callback URLs. |
| Sign-in succeeds but a reload loses the session | Check the website-origin callback, canonical domain, and proxy cookie forwarding. |
| Desktop remains signed out | Complete browser sign-in and onboarding, then explicitly approve the matching code and computer. Start a new pairing attempt if the code expired. |

Automated auth checks, run from the repository root:

```bash
npm --prefix server test -- --runInBand
npm --prefix server run test:e2e -- --testPathPattern=google-auth
```

The Google integration tests replace Google's HTTPS responses and use an isolated Mongo database. A live Google consent round trip still requires registered callbacks and a human test account.
