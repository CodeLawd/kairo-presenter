import fs from 'node:fs'
import path from 'node:path'
import SqliteDatabase from 'better-sqlite3'
import { matchGlobalQuote, retrieveGlobalQuote } from '../src/main/services/scripture/global-quote'
import { evaluateReplayCase, recordedEventsToReplay, summarizeReplay, type ReplayFixture } from '../src/main/services/scripture/replay-report'
import type { RecordedTranscriptEvent } from '../src/main/services/scripture/transcript-recording'

async function main(): Promise<void> {
 const args = process.argv.slice(2)
 const option = (name: string, fallback?: string): string | undefined => { const at=args.indexOf(name);if(at<0)return fallback;if(!args[at+1]||args[at+1].startsWith('--'))throw new Error(`${name} requires a value`);return args[at+1] }
 if(args.includes('--help')) { console.log('Usage: bun run replay:scripture [--fixture file.json | --recording file.jsonl --annotations fixture.json] [--db bible.db] [--out report.json] [--split all|calibration|held-out] [--check]\nNo network calls. Measures corpus retrieval/scoring and annotated replay timing, not audio-to-screen performance.');return }
 const dbPath=path.resolve(option('--db','resources/bible.db')!)
 const recording=option('--recording')
 const fixturePath=option('--fixture', 'tests/fixtures/scripture-replay/quotation-corpus.json')!
 const annotations=option('--annotations')
 let fixture=JSON.parse(fs.readFileSync(annotations??fixturePath,'utf8')) as ReplayFixture
 if(fixture.version!==1||!Array.isArray(fixture.cases))throw new Error('Expected version 1 replay fixture with cases')
 if(recording) {
  const events=fs.readFileSync(recording,'utf8').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line) as RecordedTranscriptEvent)
  if(!annotations)throw new Error('--recording requires --annotations: label expected references and evidence times rather than treating unlabelled speech as negative')
  if(fixture.cases.length!==1)throw new Error('Recording annotations must contain exactly one case')
  fixture={...fixture,cases:[{...fixture.cases[0],events:recordedEventsToReplay(events)}]}
 }
 const split=option('--split','all')!
 if(!['all','held-out','calibration'].includes(split))throw new Error('Invalid --split')
 const cases=fixture.cases.filter(row=>split==='all'||row.split===split)
 const db=new SqliteDatabase(dbPath,{readonly:true,fileMustExist:true})
 try {
  const corpus=db.prepare('SELECT translation_id AS translation,COUNT(*) AS verses FROM verses GROUP BY translation_id').all()
  const results=[]
  for(const scenario of cases) results.push(await evaluateReplayCase(scenario,text=>matchGlobalQuote(text,retrieveGlobalQuote(db,text))))
  const report={version:1,generatedAt:new Date().toISOString(),fixtureDescription:fixture.description,corpus,measurement:{recognizer:'existing-FTS-and-local-quotation-scorer',timing:'sequential evaluation per supplied event; no live scheduling/IPC/output renderer',audioToScreen:'not measured',notes:'Evidence timing is only reported where independently annotated in the fixture arrival-clock domain. Synthetic fixtures are not real recordings. Scorer alternatives are counted as wrong only if absent from annotations. No AI fallback is called.'},summary:summarizeReplay(results),splits:{calibration:summarizeReplay(results.filter(r=>r.split==='calibration')),'held-out':summarizeReplay(results.filter(r=>r.split==='held-out'))},results}
  const output=JSON.stringify(report,null,2)+'\n'
  const out=option('--out');if(out)fs.writeFileSync(out,output,{mode:0o600})
  if(args.includes('--check') && (report.summary.missedExpectedLocalCases || report.summary.wrongPassageCases || report.summary.falsePositiveNegativeCases)) process.exitCode=1
  console.log(JSON.stringify({corpus,summary:report.summary,splits:report.splits,failures:results.filter(r=>r.wrong.length||r.missing.length).map(({id,missing,wrong})=>({id,missing,wrong})),...(out?{report:path.resolve(out)}:{})},null,2))
 }finally { db.close() }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
