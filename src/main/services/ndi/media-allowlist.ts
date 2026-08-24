import { resolve } from 'path'

const pickedMediaPaths = new Set<string>()

export function allowPickedOverlayMedia(filePath: string): void {
  pickedMediaPaths.add(resolve(filePath))
}

export function isPickedOverlayMediaAllowed(filePath: string): boolean {
  return pickedMediaPaths.has(resolve(filePath))
}
