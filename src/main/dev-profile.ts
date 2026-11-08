/**
 * A local dev build (`npm run dev`) keeps its own settings, sign-in, licence
 * device and logs, apart from the installed Kairo on the same Mac or PC. With
 * one shared profile the two fought over a single sign-in token — each refresh
 * spent the token the other still held — and the server signed both out.
 *
 * Imported first in the main entry: settings stores open on import, so the
 * path has to be moved before any of them run. `KAIRO_SHARED_PROFILE=1` opts
 * back into the installed app's profile when a bug needs its real data.
 * The workspace folder (Songs, Media in Documents) is still shared.
 */
import { app } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'

export const DEV_PROFILE_NAME = 'Kairo Dev'

// `app` is missing when tests load main-process modules outside Electron.
if (app && !app.isPackaged && process.env.KAIRO_SHARED_PROFILE !== '1') {
  app.setPath('userData', join(app.getPath('appData'), DEV_PROFILE_NAME))
  const logs = join(app.getPath('userData'), 'logs')
  app.setPath('logs', logs)
  // electron-log names its folder after the app, which is still "Kairo".
  log.transports.file.resolvePathFn = () => join(logs, 'main.log')
}
