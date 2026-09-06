export const SHORTCUT_COMMANDS = [
  { id: 'search', label: 'Focus search', group: 'Navigation', defaults: ['Mod+f'] },
  { id: 'previous', label: 'Previous suggestion', group: 'Navigation', defaults: ['ArrowLeft', 'ArrowUp'] },
  { id: 'next', label: 'Next suggestion', group: 'Navigation', defaults: ['ArrowRight', 'ArrowDown'] },
  { id: 'approve', label: 'Present selected suggestion', group: 'Live commands', defaults: ['Space', 'Enter'] },
  { id: 'dismiss', label: 'Dismiss top suggestion', group: 'Live commands', defaults: ['Escape'] },
  { id: 'clear', label: 'Clear live text', group: 'Live commands', defaults: ['Backspace', 'Delete'] },
  { id: 'auto', label: 'Toggle auto mode', group: 'Live commands', defaults: ['Mod+a'] },
] as const
export type ShortcutCommand = typeof SHORTCUT_COMMANDS[number]['id']
export type ShortcutBindings = Partial<Record<ShortcutCommand, string[]>>
export interface ShortcutKeyEvent { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  return [event.metaKey || event.ctrlKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}
export function bindingsFor(id: ShortcutCommand, bindings: ShortcutBindings = {}): readonly string[] {
  return bindings[id] ?? SHORTCUT_COMMANDS.find(command => command.id === id)!.defaults
}
export function commandForShortcut(shortcut: string, bindings: ShortcutBindings = {}): ShortcutCommand | undefined {
  return SHORTCUT_COMMANDS.find(command => bindingsFor(command.id, bindings).includes(shortcut))?.id
}
export function shortcutLabel(shortcut: string): string {
  return shortcut.split('+').map(key => ({ Mod: '⌘ / Ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' })[key] ?? (key.length === 1 ? key.toUpperCase() : key)).join(' + ')
}
