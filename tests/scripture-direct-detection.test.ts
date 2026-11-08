import test from 'node:test'
import assert from 'node:assert/strict'
import { ScriptureDetector } from '../src/main/services/scripture/detector'
test('ordinary prayer cannot become AI paraphrase suggestions', async () => {
 const detector = new ScriptureDetector({ apiKey: 'test' })
 const emitted: unknown[] = []
 detector.on('detection', refs => emitted.push(...refs))
 Object.assign(detector, { callModel: async () => JSON.stringify([{book:'Matthew',chapter:24,verseStart:11,confidence:0.9,detectionType:'paraphrase',sourceText:'do not let anyone deceive us'}]) })
 await detector.analyze('Father do not let anyone deceive us as we pray today')
 assert.equal(emitted.length,0)
 detector.destroy()
})
test('AI quotation guesses require a matching local quotation', async () => {
 const detector = new ScriptureDetector({ apiKey: 'test' })
 const emitted: unknown[] = []
 detector.on('detection', refs => emitted.push(...refs))
 Object.assign(detector, { callModel: async () => JSON.stringify([{book:'Matthew',chapter:24,verseStart:11,confidence:0.99,detectionType:'quote',sourceText:'deceive us'}]) })
 detector.setGeneralQuoteProvider(async () => [])
 await detector.analyze('Father do not let anyone deceive us as we pray today')
 assert.equal(emitted.length,0)
 detector.destroy()
})
test('live quotation search does not request speculative paraphrase matches', async () => {
 const detector = new ScriptureDetector({ apiKey: '' })
 let possible: boolean | undefined
 detector.setGeneralQuoteProvider(async (_text, requested) => { possible = requested; return [] })
 await detector.analyzeGeneralQuote('do not let anyone deceive us')
 assert.equal(possible,false)
 detector.destroy()
})
