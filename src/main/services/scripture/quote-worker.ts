import { parentPort, workerData } from 'node:worker_threads'
import Sqlite from 'better-sqlite3'
import { matchGlobalQuote, retrieveGlobalQuote, wordRarity } from './global-quote'
import { CacheQuoteIndex } from './cache-quote-index'
import type { CachedQuoteVerse } from './api-bible-cache'
const db = new Sqlite(workerData.dbPath, { readonly: true, fileMustExist: true })
const cache = new CacheQuoteIndex()
// Verse counts per word, from the Bibles on this machine; paraphrase evidence needs rare words.
const rarity = wordRarity(db)
type Command = { id: number; text: string; possible?: boolean; type?: undefined }
  | { type: 'cache-begin' | 'cache-commit'; version: number }
  | { type: 'cache-append'; version: number; rows: CachedQuoteVerse[]; chunkId: number }
parentPort!.on('message', (message: Command) => {
  try {
    if (message.type === 'cache-begin') { cache.begin(message.version); return }
    if (message.type === 'cache-append') {
      cache.append(message.version, message.rows)
      parentPort!.postMessage({ cacheAck: message.chunkId })
      return
    }
    if (message.type === 'cache-commit') { cache.commit(message.version); return }
    if (message.type === undefined) parentPort!.postMessage({ id: message.id,
      matches: matchGlobalQuote(message.text, [...retrieveGlobalQuote(db, message.text), ...cache.search(message.text)],
        message.possible ? rarity : undefined) })
  } catch (error) {
    if (message.type === undefined) parentPort!.postMessage({ id: message.id,
      error: error instanceof Error ? error.message : String(error) })
    else {
      cache.close()
      if (message.type === 'cache-append') parentPort!.postMessage({ cacheAck: message.chunkId,
        error: error instanceof Error ? error.message : String(error) })
      // Fail closed for the licensed corpus, while retaining the public/local index.
    }
  }
})
parentPort!.postMessage({ ready: true })
