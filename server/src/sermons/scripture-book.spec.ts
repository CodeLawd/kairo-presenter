import { bookFromReference, tallyBooks } from './scripture-book'

describe('bookFromReference', () => {
  it('reads a canonical reference', () => {
    expect(bookFromReference('Romans 8:1')).toBe('Romans')
  })

  it('does not let John swallow 1 John', () => {
    expect(bookFromReference('1 John 4:8')).toBe('1 John')
    expect(bookFromReference('John 3:16')).toBe('John')
  })

  it('accepts a common abbreviation', () => {
    expect(bookFromReference('1 Cor 13:4-7')).toBe('1 Corinthians')
    expect(bookFromReference('Ps 23')).toBe('Psalms')
  })

  it('returns null when nothing matches', () => {
    expect(bookFromReference('not a verse')).toBeNull()
    expect(bookFromReference('')).toBeNull()
  })
})

describe('tallyBooks', () => {
  it('counts by book and sorts by frequency', () => {
    expect(
      tallyBooks(['Romans 8:1', 'Romans 8:28', 'John 3:16', 'Rom 5:8']),
    ).toEqual([
      { book: 'Romans', count: 3 },
      { book: 'John', count: 1 },
    ])
  })
})
