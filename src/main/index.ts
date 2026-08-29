import { app, BrowserWindow, Menu, shell, protocol, net } from 'electron'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { realpathSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { configuredMediaPaths } from '@shared/overlay-outputs'
import { PA_MEDIA_URL_PREFIX } from '@shared/overlay-template'
import { registerIpcHandlers } from './ipc'
import { initDatabase, store } from './db'
import { lyricsService } from './services/lyrics'
import { scriptureService } from './services/scripture'
import { initOfflineBibles } from './services/scripture/offline-bibles'
import { ndiService } from './services/ndi'
import { overlayWindow } from './services/ndi/overlay-window'
import { isPickedOverlayMediaAllowed } from './services/ndi/media-allowlist'
import { isInsideRoot, mediaService } from './services/media'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'debug' : 'warn'
log.info('ProAutomate starting', { version: app.getVersion() })

// pa-media:// — serves the overlay theme's background image/video to both the
// renderer (Theme editor preview; its http/file origin can't load file:// under
// webSecurity) and the offscreen NDI overlay window, through one code path.
// Must be declared before app ready; `stream: true` lets <video> play from it.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pa-media', privileges: { stream: true } },
])

/**
 * Whether `requested` sits inside the backgrounds folder the user picked.
 *
 * The dock indexes a whole directory, so its files cannot be enumerated into an
 * exact-path allowlist the way a hand-picked theme background is — a file
 * dropped in after the last scan has to play too. That makes this a PREFIX
 * test, and the two ways a prefix test leaks are closed here:
 *
 *   - both sides are realpath'd, so a symlink inside the folder cannot point at
 *     /etc and inherit the folder's permission;
 *   - the comparison requires a path separator after the root, so a sibling
 *     directory like `<root>-private` does not match.
 *
 * The root is only ever a directory the user chose in a native picker.
 */
function isUnderMediaFolder(requested: string): boolean {
  const root = mediaService.allowedRoot()
  if (!root) return false
  try {
    return isInsideRoot(realpathSync(requested), realpathSync(root))
  } catch {
    // A path that cannot be resolved (missing, or a broken symlink) is not served.
    return false
  }
}

function registerPaMediaProtocol(): void {
  protocol.handle('pa-media', (request) => {
    try {
      if (!request.url.startsWith(PA_MEDIA_URL_PREFIX)) {
        return new Response('Bad request', { status: 400 })
      }
      const requested = resolve(
        decodeURIComponent(request.url.slice(PA_MEDIA_URL_PREFIX.length))
      )

      // Allowlist: only background media the user has already configured is
      // servable — the scheme must not become an arbitrary-file-read bridge.
      // Saved library themes count too, so the Theme editor can preview a stored
      // theme in a later session (the picked-media allowlist only survives the
      // session in which the file was chosen).
      const allowed = new Set(
        configuredMediaPaths(store.get('overlay'), store.get('themeLibrary')).map((p) => resolve(p))
      )
      if (!allowed.has(requested) && !isPickedOverlayMediaAllowed(requested) &&
          !isUnderMediaFolder(requested)) {
        log.warn('[pa-media] Blocked non-configured path', { requested })
        return new Response('Forbidden', { status: 403 })
      }

      return net.fetch(pathToFileURL(requested).toString())
    } catch (err) {
      log.warn('[pa-media] Request failed', (err as Error).message)
      return new Response('Bad request', { status: 400 })
    }
  })
}

function setupApplicationMenu(): void {
  // Standard Edit roles (Select All, Copy, Paste, …) must live on the app menu
  // or their accelerators never reach focused inputs in Electron.
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#171717',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    log.info('Main window shown')
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.proautomate')
  setupApplicationMenu()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  registerPaMediaProtocol()
  lyricsService.open()
  scriptureService.open()
  scriptureService.setDefaultTranslation(store.get('scripture').defaultTranslation)
  initOfflineBibles()
  registerIpcHandlers()

  // M0: start the NDI sender unconditionally on launch (hardcoded transparent
  // test frame until the overlay window pushes real content). A missing/broken
  // grandiose-mac native module logs and no-ops — never blocks app boot.
  ndiService.start().catch((err) => {
    log.error('[NDI] start() failed:', (err as Error).message)
  })

  // First ProPresenter handshake is the launch gate in the renderer — connecting
  // here would retry (and log timeouts) before the operator has confirmed PP is open.

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  log.info('All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  overlayWindow.destroy()
  ndiService.stop().catch((err) => {
    log.error('[NDI] stop() failed during quit:', (err as Error).message)
  })
})

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
  try {
    const { resilienceManager } = require('./services/resilience')
    resilienceManager.serializeState()
  } catch (err) {
    log.error('Failed to serialize state during uncaughtException:', err)
  }
})

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection at:', promise, 'reason:', reason)
  try {
    const { resilienceManager } = require('./services/resilience')
    resilienceManager.serializeState()
  } catch (err) {
    log.error('Failed to serialize state during unhandledRejection:', err)
  }
})
