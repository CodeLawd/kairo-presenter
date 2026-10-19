import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import type { InterimResult, TranscriptResult } from '../../../../lib/ipc';
import { ScriptureDetector, type ScriptureReference } from '../detector';
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring';

type Step = string | { interim: string } | { waitMs: number };

/**
 * Feeds speech through the real live wiring, with the model stubbed out. A
 * string is a final transcript; `{ interim }` a partial one; `{ waitMs }`
 * moves the clock on.
 */
function hear(steps: Step[]): Array<{ ref: string; translations?: string[] }> {
  let finalListener!: (result: TranscriptResult) => void;
  let interimListener!: (result: InterimResult) => void;
  const source = {
    onTranscript(listener: typeof finalListener) { finalListener = listener; },
    offTranscript() {},
    onInterim(listener: typeof interimListener) { interimListener = listener; },
    offInterim() {},
  };
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const detector = new ScriptureDetector({ apiKey: 'test-key' });
  Object.assign(detector, { callModel: async () => '[]' });
  const found: ScriptureReference[] = [];
  detector.on('detection', (refs) => found.push(...refs));
  const cleanup = subscribeExplicitScriptureDetection(source, detector);
  try {
    for (const step of steps) {
      if (typeof step === 'string') finalListener({ text: step, isFinal: true } as TranscriptResult);
      else if ('interim' in step) interimListener({ text: step.interim } as InterimResult);
      else mock.timers.tick(step.waitMs);
    }
  } finally {
    cleanup();
    detector.destroy();
    mock.timers.reset();
  }
  return found.map((r) => ({
    ref: `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd ? `-${r.verseEnd}` : ''}`,
    ...(r.translations ? { translations: r.translations } : {}),
  }));
}

test('a translation named with a reference travels with it', () => {
  assert.deepEqual(hear(['Turn with me to John 3:16 in the NLT.']), [
    { ref: 'John 3:16', translations: ['NLT'] },
  ]);
});

test('no translation named leaves the choice to the playlist or default', () => {
  assert.deepEqual(hear(['Turn with me to John 3:16.']), [{ ref: 'John 3:16' }]);
});

test('several translations named together each come through', () => {
  assert.deepEqual(hear(['Romans 8:28 in the NLT and the NIV.']), [
    { ref: 'Romans 8:28', translations: ['NLT', 'NIV'] },
  ]);
});

test('the same verse again in a new translation is not swallowed as a repeat', () => {
  assert.deepEqual(hear(['Turn to John 3:16.', 'Now John 3:16 in the NIV.', 'John 3:16 again.']), [
    { ref: 'John 3:16' },
    { ref: 'John 3:16', translations: ['NIV'] },
  ]);
});

test('"read it in the NLT and NIV" with no reference asks for the last passage', () => {
  assert.deepEqual(hear(['Turn to Ephesians 2:8-9.', "Let's read that in the NLT and the NIV."]), [
    { ref: 'Ephesians 2:8-9' },
    { ref: 'Ephesians 2:8-9', translations: ['NLT', 'NIV'] },
  ]);
});

test('asking twice for the same translation does not repeat it', () => {
  assert.deepEqual(hear(['Turn to Ephesians 2:8.', 'In the NIV.', 'Again in the NIV.']), [
    { ref: 'Ephesians 2:8' },
    { ref: 'Ephesians 2:8', translations: ['NIV'] },
  ]);
});

test('a translation named before any passage is ignored', () => {
  assert.deepEqual(hear(['I grew up reading the King James.']), []);
});

test('a translation said before the verse still goes with it', () => {
  assert.deepEqual(hear(['The NLT puts John 3:16 this way.']), [
    { ref: 'John 3:16', translations: ['NLT'] },
  ]);
});

test('a lower-case transcript is understood', () => {
  assert.deepEqual(hear(['turn to john 3:16 in the niv.']), [
    { ref: 'John 3:16', translations: ['NIV'] },
  ]);
});

test('spoken numbers and spelled-out letters are understood together', () => {
  assert.deepEqual(hear(['John three sixteen in the N L T.']), [
    { ref: 'John 3:16', translations: ['NLT'] },
  ]);
});

test('two verses named with one translation both take it', () => {
  assert.deepEqual(hear(['John 3:16 and Romans 8:28 in the NIV.']), [
    { ref: 'John 3:16', translations: ['NIV'] },
    { ref: 'Romans 8:28', translations: ['NIV'] },
  ]);
});

test('a verse range keeps its range and its translation', () => {
  assert.deepEqual(hear(['Ephesians 2:8-9 in the King James Version.']), [
    { ref: 'Ephesians 2:8-9', translations: ['KJV'] },
  ]);
});

test('a half-heard sentence and its final give one card per translation', () => {
  assert.deepEqual(
    hear([{ interim: 'John 3:16' }, { interim: 'John 3:16 in the NLT' }, 'John 3:16 in the NLT.']),
    [
      { ref: 'John 3:16' },
      { ref: 'John 3:16', translations: ['NLT'] },
    ],
  );
});

test('a translation asked for long after the passage is not tied to it', () => {
  assert.deepEqual(hear(['Turn to Ephesians 2:8.', { waitMs: 121_000 }, 'Now in the NIV.']), [
    { ref: 'Ephesians 2:8' },
  ]);
});

test('a translation asked for within two minutes is tied to the passage', () => {
  assert.deepEqual(hear(['Turn to Ephesians 2:8.', { waitMs: 90_000 }, 'Now in the NIV.']), [
    { ref: 'Ephesians 2:8' },
    { ref: 'Ephesians 2:8', translations: ['NIV'] },
  ]);
});

test('everyday words after a passage do not ask for a translation', () => {
  assert.deepEqual(
    hear([
      'Turn to Ephesians 2:8.',
      'We serve the new living God.',
      'The message today is grace.',
      'Our voices are amplified by his Spirit.',
    ]),
    [{ ref: 'Ephesians 2:8' }],
  );
});

test('a follow-up translation goes to the latest passage, not an earlier one', () => {
  assert.deepEqual(hear(['John 3:16.', 'Then Romans 8:28.', 'Read that in the ESV.']), [
    { ref: 'John 3:16' },
    { ref: 'Romans 8:28' },
    { ref: 'Romans 8:28', translations: ['ESV'] },
  ]);
});

test('each new translation for one verse comes once, the default is not repeated', () => {
  assert.deepEqual(
    hear(['John 3:16.', 'In the NIV.', 'John 3:16 in the NLT.', 'John 3:16.', 'NIV and NLT again.']),
    [
      { ref: 'John 3:16' },
      { ref: 'John 3:16', translations: ['NIV'] },
      { ref: 'John 3:16', translations: ['NLT'] },
    ],
  );
});
