import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { registerIpcHandlers } from './ipc'
import { initDatabase, store } from './db'
import { lyricsService } from './services/lyrics'
import { scriptureService } from './services/scripture'
import { proPresenterService } from './services/propresenter'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'debug' : 'warn'
log.info('ProAutomate starting', { version: app.getVersion() })

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d1b2a',
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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  lyricsService.open()
  scriptureService.open()
  registerIpcHandlers()

  // Auto-connect to ProPresenter using stored settings
  const ppSettings = store.get('propresenter')
  if (ppSettings && ppSettings.host) {
    log.info('[PP] Auto-connecting to ProPresenter on startup', { host: ppSettings.host, port: ppSettings.port })
    proPresenterService.connect({
      host: ppSettings.host,
      port: ppSettings.port,
      password: ppSettings.password || ''
    }).catch((err) => {
      log.error('[PP] Auto-connection on startup failed:', (err as Error).message)
    })
  }

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
