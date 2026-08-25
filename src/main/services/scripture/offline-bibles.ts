import path from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import { store } from '../../db'
import { ApiBibleCache } from './api-bible-cache'
import { ApiCacheCrypto } from './api-cache-crypto'
import { ApiBibleDownloadManager } from './api-bible-download-manager'
import { isOfflineDownloadPermitted, resolveOfflineDownloadBibleIds } from './offline-download-policy'
import { scriptureService } from './index'

let downloadManager: ApiBibleDownloadManager | null = null

/**
 * Opens the encrypted API.Bible cache under `userData` and wires it into the
 * scripture service and the download manager. Cache paths and the encryption
 * key never leave the main process. Fails soft: without OS encryption the app
 * still works online, it simply caches nothing.
 */
export function initOfflineBibles(): void {
  try {
    const crypto = ApiCacheCrypto.open(path.join(app.getPath('userData'), 'api-bible-cache.key'))
    const cache = ApiBibleCache.open(path.join(app.getPath('userData'), 'api-bible-cache.db'), crypto)
    scriptureService.attachApiCache(cache)

    downloadManager = new ApiBibleDownloadManager({
      cache,
      getClient: () => scriptureService.getClient(store.get('stt').bibleApiKey),
      getAuthorizedTranslations: () =>
        scriptureService.listAuthorizedTranslations(store.get('stt').bibleApiKey),
      isOfflineDownloadEnabled: (bibleId) =>
        isOfflineDownloadPermitted(
          bibleId,
          resolveOfflineDownloadBibleIds(store.get('scripture').offlineDownloadBibleIds),
          cache.getTranslationState(bibleId)?.copyright ?? '',
        ),
    })
    downloadManager.recoverInterruptedDownloads()
    log.info('[Scripture] Offline Bible cache ready')
  } catch (error) {
    scriptureService.attachApiCache(null)
    downloadManager = null
    log.warn('[Scripture] Offline Bible cache disabled', (error as Error).message)
  }
}

export function getDownloadManager(): ApiBibleDownloadManager {
  if (!downloadManager) {
    throw new Error('Offline Bible storage is unavailable on this machine.')
  }
  return downloadManager
}

export function hasDownloadManager(): boolean {
  return downloadManager !== null
}
