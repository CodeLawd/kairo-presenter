import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { ScriptureDetector, type ScriptureReference } from '../detector';

const key = (r: ScriptureReference): string => `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd ? `-${r.verseEnd}` : ''}`;
const cases: Array<{ name: string; segments: string[]; expected: string[] }> = [
  { name: 'split numbered book', segments: ['Second Corinthians', 'chapter seven', 'verse ten'], expected: ['2 Corinthians 7:10'] },
  { name: 'single chapter book', segments: ['Jude verse five'], expected: ['Jude 1:5'] },
  { name: 'single chapter numbered book', segments: ['Third John verse four'], expected: ['3 John 1:4'] },
  { name: 'chapter change', segments: ['John 3:16', 'now chapter four verse two'], expected: ['John 3:16', 'John 4:2'] },
  { name: 'correction in same segment', segments: ['John chapter three verse sixteen sorry verse seventeen'], expected: ['John 3:17'] },
  { name: 'discrete verse list', segments: ['John chapter three verses two, five, and nine'], expected: ['John 3:2', 'John 3:5', 'John 3:9'] },
  { name: 'nonadjacent pair is not a range', segments: ['John three verses two and five'], expected: ['John 3:2', 'John 3:5'] },
  { name: 'ordinary numeric speech', segments: ['John chapter three', '16 people came forward'], expected: [] },
  { name: 'verse then ordinary numeric speech', segments: ['John 3:16', '17 people came forward'], expected: ['John 3:16'] },
  { name: 'clear interim-equivalent citation', segments: ['Joshua chapter number one and we begin to read from verse nine'], expected: ['Joshua 1:9'] },
  { name: 'invalid verse', segments: ['2 Corinthians 7:100'], expected: [] },
  { name: 'chapter only does not invent verse', segments: ['Acts of the Apostles chapter sixteen'], expected: [] },
];
for (const scenario of cases) {
  test(`replay: ${scenario.name}`, () => {
    const detector = new ScriptureDetector({ apiKey: '' });
    const found: string[] = [];
    detector.on('detection', refs => found.push(...refs.map(key)));
    try {
      for (const segment of scenario.segments) detector.analyzeExplicit(segment, true);
      assert.deepEqual(found, scenario.expected);
    } finally { detector.destroy(); }
  });
}

test('replay: stale chapter expires without delaying a new explicit citation', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  const found: string[] = [];
  detector.on('detection', refs => found.push(...refs.map(key)));
  try {
    detector.analyzeExplicit('John chapter three', true);
    now += 13_000;
    detector.analyzeExplicit('verse sixteen', true);
    assert.deepEqual(found, []);
    detector.analyzeExplicit('Romans 8:28', true, true);
    assert.deepEqual(found, ['Romans 8:28']);
  } finally { Date.now = original; detector.destroy(); }
});

test('clear citations emit synchronously without an AI call or debounce', () => {
  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const detector = new ScriptureDetector({ apiKey: 'test' });
    detector.setQuoteSearchProvider(() => { assert.fail('clear citation must not run quote search'); });
    let emitted = false;
    detector.on('processing', () => assert.fail('clear citation must not use AI'));
    detector.on('detection', () => { emitted = true; });
    const start = performance.now();
    detector.analyzeExplicit('Hebrews chapter thirteen verse five', true, true);
    samples.push(performance.now() - start);
    assert.equal(emitted, true, 'must emit before the call returns');
    detector.destroy();
  }
  samples.sort((a, b) => a - b);
  console.log(`Local parser latency (100 replays): p50=${samples[50].toFixed(3)}ms p95=${samples[95].toFixed(3)}ms max=${samples[99].toFixed(3)}ms`);
});

for (const [text, expected] of [
  ['John 3:16 and Romans 8:28', ['John 3:16', 'Romans 8:28']],
  ['Isaiah 62 verses eleven and twelve', ['Isaiah 62:11-12']],
  ['Psalm 119:176', ['Psalms 119:176']],
  ['John 3:16-100', []],
  ['Give me Hebrews chapter number thirteen and verse five', ['Hebrews 13:5']],
  ['First Corinthians chapter thirteen verse four', ['1 Corinthians 13:4']],
  ['John 3:16, sorry verse 17', ['John 3:17']],
  ['God is good and he is faithful', []],
  ['We have three announcements and sixteen volunteers', []],
] as Array<[string, string[]]>) {
  test(`interim replay: ${text}`, () => {
    const detector = new ScriptureDetector({ apiKey: '' });
    const found: string[] = [];
    detector.on('detection', refs => found.push(...refs.map(key)));
    detector.analyzeExplicit(text, true, true);
    assert.deepEqual(found, expected);
    detector.analyzeExplicit(text, true, false);
    assert.deepEqual(found, expected, 'final must not duplicate its interim');
    detector.destroy();
  });
}

test('revised interim citation replaces the last detected verse immediately', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const found: string[] = [];
  detector.on('detection', refs => found.push(...refs.map(key)));
  detector.analyzeExplicit('John chapter three', true, true);
  assert.deepEqual(found, []);
  detector.analyzeExplicit('John chapter three verse sixteen', true, true);
  detector.analyzeExplicit('John chapter three verse seventeen', true, true);
  assert.deepEqual(found, ['John 3:16', 'John 3:17']);
  detector.destroy();
});

test('split verse lists never expand to unspoken intermediate verses', () => {
  for (const segments of [
    ['John chapter three', 'verses two, five, and nine'],
    ['John chapter three', 'two and five'],
  ]) {
    const detector = new ScriptureDetector({ apiKey: '' });
    const found: string[] = [];
    detector.on('detection', refs => found.push(...refs.map(key)));
    for (const text of segments) detector.analyzeExplicit(text, true);
    assert.deepEqual(found, segments[1].includes('nine') ? ['John 3:2', 'John 3:5', 'John 3:9'] : ['John 3:2', 'John 3:5']);
    detector.destroy();
  }
});

for (const book of ['Psalm', 'John', 'Hebrews']) {
  for (const separator of [' ', ', ', ',']) {
    for (const connector of ['', 'verse ', 'we will read from verse ', 'we shall read from verse ', 'we begin to read from verse ']) {
      const chapter = book === 'Psalm' ? 66 : 3;
      const text = `${book} ${chapter}${separator}${connector}eight to nine.`;
      test(`spoken citation punctuation: ${text}`, () => {
        const detector = new ScriptureDetector({ apiKey: '' });
        const found: string[] = [];
        detector.on('detection', refs => found.push(...refs.map(key)));
        detector.analyzeExplicit(text, true, true);
        assert.deepEqual(found, [`${book === 'Psalm' ? 'Psalms' : book} ${chapter}:8-9`]);
        detector.destroy();
      });
    }
  }
}
