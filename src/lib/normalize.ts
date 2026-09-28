// ─── Validation primitives for settings normalizers ──────────────────────────
// Pure — no Node/DOM APIs. Shared by overlay-defaults (themes, outputs) and
// program (presentation settings) so both clamp and validate the same way.

export const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function asObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {}
}

export function safeString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

export function safeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function safeNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = safeNumber(v, fallback)
  return Math.min(max, Math.max(min, n))
}

export function nonNegNumber(v: unknown, fallback: number): number {
  const n = safeNumber(v, fallback)
  return n < 0 ? fallback : n
}

export function safeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : fallback
}

export function safeEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}
