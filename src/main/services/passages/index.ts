import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import {
  withPassage,
  type PassagesCommand, type SavedPassage,
} from '@shared/passages'
import { librariesService } from '../libraries'

/** Passages the operator kept, with their verse text, for offline recall. */
class PassagesService {
  private readonly db = new Store<{ passages: SavedPassage[] }>({
    name: 'kairo-passages',
    defaults: { passages: [] },
  })
  private listeners: Array<(passages: SavedPassage[]) => void> = []

  snapshot(): SavedPassage[] {
    const stored = this.db.get('passages')
    return Array.isArray(stored)
      ? stored.filter(passage => typeof passage?.id === 'string' && Array.isArray(passage.verses))
      : []
  }

  onChanged(callback: (passages: SavedPassage[]) => void): void {
    this.listeners.push(callback)
  }

  private write(passages: SavedPassage[]): SavedPassage[] {
    this.db.set('passages', passages)
    for (const listener of this.listeners) listener(passages)
    return passages
  }

  apply(command: PassagesCommand): SavedPassage[] {
    const current = this.snapshot()
    switch (command.action) {
      case 'list':
        return current

      case 'save': {
        const { result } = command
        if (!result?.reference || !Array.isArray(result.verses) || result.verses.length === 0) {
          throw new Error('Look up a passage before saving it.')
        }
        const passage: SavedPassage = {
          id: randomUUID(),
          reference: String(result.reference).slice(0, 200),
          translation: result.translation,
          verses: result.verses,
          savedAt: Date.now(),
        }
        const next = withPassage(current, passage)
        const saved = next.find(item =>
          item.reference === passage.reference && item.translation === passage.translation)
        if (command.libraryId && saved) {
          librariesService.apply({
            action: 'assign',
            kind: 'scripture',
            itemIds: [saved.id],
            libraryId: command.libraryId,
          })
        }
        return this.write(next)
      }

      case 'remove':
        librariesService.forgetItem('scripture', command.passageId)
        return this.write(current.filter(passage => passage.id !== command.passageId))

      default:
        throw new Error('Unknown passage command.')
    }
  }
}

export const passagesService = new PassagesService()
