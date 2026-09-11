import { parseSermonSummary, stripCodeFences, SummaryFormatError } from './sermon-summary.parse'

const TRANSCRIPT =
  'Turn with me to Romans chapter eight. Paul writes that there is now no condemnation ' +
  'for those who are in Christ Jesus.\nThat is not a feeling you work up. It is a verdict ' +
  'already handed down. Live like the verdict is in.'

function summaryJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    headline: 'No Condemnation',
    bigIdea:
      'Paul taught that freedom from condemnation rests on what Christ has already done, not on a feeling a believer must create.',
    keyPoints: [
      { title: 'The verdict is already in', explanation: 'Believers can live from an accomplished verdict rather than striving to earn one.' },
    ],
    memorableQuotes: ['It is a verdict already handed down.'],
    takeaways: ['Name one thing you are still condemning yourself for.'],
    keyScriptures: [{ reference: 'Romans 8:1', connection: 'The sermon’s anchor text.' }],
    callToAction: 'Live like the verdict is in.',
    ...overrides,
  })
}

describe('parseSermonSummary', () => {
  it('parses a well-formed summary', () => {
    const summary = parseSermonSummary(summaryJson(), TRANSCRIPT)
    expect(summary.headline).toBe('No Condemnation')
    expect(summary.keyPoints).toHaveLength(1)
    expect(summary.keyPoints[0].explanation).toContain('accomplished verdict')
    expect(summary.keyScriptures[0].reference).toBe('Romans 8:1')
    expect(summary.callToAction).toBe('Live like the verdict is in.')
  })

  it('drops a quote the speaker never said', () => {
    // The one failure that would put invented words on a public page under a
    // pastor's name, so it gets its own case.
    const raw = summaryJson({
      memorableQuotes: [
        'It is a verdict already handed down.',
        'God helps those who help themselves.',
      ],
    })
    expect(parseSermonSummary(raw, TRANSCRIPT).memorableQuotes).toEqual([
      'It is a verdict already handed down.',
    ])
  })

  it('still matches a quote across a line break', () => {
    const raw = summaryJson({
      memorableQuotes: ['in Christ Jesus.\n   That is not a feeling you work up.'],
    })
    expect(parseSermonSummary(raw, TRANSCRIPT).memorableQuotes).toHaveLength(1)
  })

  it('accepts JSON wrapped in a code fence', () => {
    const fenced = '```json\n' + summaryJson() + '\n```'
    expect(parseSermonSummary(fenced, TRANSCRIPT).headline).toBe('No Condemnation')
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('caps runaway arrays and clamps long strings', () => {
    const raw = summaryJson({
      headline: 'h'.repeat(500),
      bigIdea: 'b'.repeat(2_000),
      keyPoints: Array.from({ length: 20 }, (_, index) => ({
        title: `point ${index}`,
        explanation: 'd'.repeat(5_000),
      })),
      takeaways: Array.from({ length: 20 }, (_, index) => `takeaway ${index}`),
      memorableQuotes: Array.from({ length: 20 }, () => 'It is a verdict already handed down.'),
      keyScriptures: Array.from({ length: 20 }, (_, index) => ({
        reference: `Romans 8:${index}`,
        connection: 'Used to explain freedom from condemnation.',
      })),
    })
    const summary = parseSermonSummary(raw, TRANSCRIPT)
    expect(summary.headline).toHaveLength(80)
    expect(summary.bigIdea).toHaveLength(700)
    expect(summary.keyPoints).toHaveLength(5)
    expect(summary.keyPoints[0].explanation).toHaveLength(500)
    expect(summary.memorableQuotes).toHaveLength(3)
    expect(summary.takeaways).toHaveLength(4)
    expect(summary.keyScriptures).toHaveLength(5)
  })

  it('drops malformed main points and scriptures rather than failing', () => {
    const raw = summaryJson({
      keyPoints: [{ explanation: 'no title' }, { title: 'kept', explanation: 'yes' }],
      keyScriptures: [
        { connection: 'no reference' },
        { reference: 'John 1:1', connection: '' },
      ],
    })
    const summary = parseSermonSummary(raw, TRANSCRIPT)
    expect(summary.keyPoints.map((point) => point.title)).toEqual(['kept'])
    expect(summary.keyScriptures.map((item) => item.reference)).toEqual(['John 1:1'])
  })

  it('rejects a response with no headline or big idea', () => {
    expect(() => parseSermonSummary(summaryJson({ headline: '' }), TRANSCRIPT)).toThrow(
      SummaryFormatError,
    )
    expect(() => parseSermonSummary('not json at all', TRANSCRIPT)).toThrow(SummaryFormatError)
    expect(() => parseSermonSummary('"a string"', TRANSCRIPT)).toThrow(SummaryFormatError)
  })

  it('omits an empty optional call to action', () => {
    expect(parseSermonSummary(summaryJson({ callToAction: '   ' }), TRANSCRIPT).callToAction)
      .toBeUndefined()
  })
})
