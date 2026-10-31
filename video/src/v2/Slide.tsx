import { slideFace } from './fonts'

/** KJV text (resources/bible.db). Public domain. */
export const KJV = {
  'John 4:7': 'There cometh a woman of Samaria to draw water: Jesus saith unto her, Give me to drink.',
  'John 4:8': '(For his disciples were gone away unto the city to buy meat.)',
  'John 4:9': 'Then saith the woman of Samaria unto him, How is it that thou, being a Jew, askest drink of me, which am a woman of Samaria? for the Jews have no dealings with the Samaritans.',
  'John 4:10': 'Jesus answered and said unto her, If thou knewest the gift of God, and who it is that saith to thee, Give me to drink; thou wouldest have asked of him, and he would have given thee living water.',
  'John 4:11': 'The woman saith unto him, Sir, thou hast nothing to draw with, and the well is deep: from whence then hast thou that living water?',
  'John 4:12': 'Art thou greater than our father Jacob, which gave us the well, and drank thereof himself, and his children, and his cattle?',
  'John 4:13': 'Jesus answered and said unto her, Whosoever drinketh of this water shall thirst again:',
  'John 4:16': 'Jesus saith unto her, Go, call thy husband, and come hither.',
  'John 4:17': 'The woman answered and said, I have no husband. Jesus said unto her, Thou hast well said, I have no husband:',
  'John 4:18': 'For thou hast had five husbands; and he whom thou now hast is not thy husband: in that saidst thou truly.',
  'John 7:38': 'He that believeth on me, as the scripture hath said, out of his belly shall flow rivers of living water.',
  'Jeremiah 2:13': 'For my people have committed two evils; they have forsaken me the fountain of living waters, and hewed them out cisterns, broken cisterns, that can hold no water.',
  'John 4:14':
    'But whosoever drinketh of the water that I shall give him shall never thirst; but the water that I shall give him shall be in him a well of water springing up into everlasting life.',
  'John 4:15': 'The woman saith unto him, Sir, give me this water, that I thirst not, neither come hither to draw.',
  'Psalm 23:1': 'The LORD is my shepherd; I shall not want.',
  'Isaiah 40:31':
    'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.',
} as const
export type Ref = keyof typeof KJV

/**
 * The church's scripture theme as captured: a deep navy gradient, bold white
 * sans in the upper middle, the reference small underneath. Laid out at
 * 1920×1080 and scaled, as the app's preview does.
 */
export function Slide({
  reference,
  width,
  text,
  textOpacity = 1,
  style,
}: {
  reference: Ref
  width: number
  /** Override the verse (for word-level highlighting). */
  text?: React.ReactNode
  textOpacity?: number
  style?: React.CSSProperties
}): React.ReactElement {
  const s = width / 1920
  return (
    <div style={{ width, height: (width * 9) / 16, position: 'relative', overflow: 'hidden', ...style }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transform: `scale(${s})`,
          transformOrigin: '0 0',
          background: 'linear-gradient(112deg, #060b16 0%, #0c1628 38%, #15253f 72%, #1c3152 100%)',
        }}
      >
        <div style={{ position: 'absolute', left: 280, right: 280, top: 318, textAlign: 'center', opacity: textOpacity }}>
          <p style={{ margin: 0, fontFamily: slideFace, fontWeight: 700, fontSize: 57, lineHeight: 1.27, color: '#fff', letterSpacing: '-0.005em' }}>
            {text ?? KJV[reference]}
          </p>
          <p style={{ margin: '34px 0 0', fontFamily: slideFace, fontWeight: 700, fontSize: 26, color: 'rgba(255,255,255,0.78)' }}>
            {reference} (KJV)
          </p>
        </div>
      </div>
    </div>
  )
}
