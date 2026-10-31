/**
 * Verse text as it is read aloud. The bundled KJV uses braces two ways: words
 * the translators supplied ("all {ye} that labour"), which are read, and
 * marginal notes ("{firmament: Heb. expansion}"), which are not. Notes always
 * carry a colon; supplied words never do.
 */
export function spokenVerseText(text: string): string {
  return text.replace(/\{([^}]*)\}/g, (_, inner: string) => (inner.includes(':') ? ' ' : inner))
}
