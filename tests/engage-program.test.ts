import {test} from 'node:test'
import assert from 'node:assert/strict'
import {renderPollHTML, programLayersFor, EMPTY_PROGRAM_STATE, DEFAULT_PRESENTATION_SETTINGS, normalizeShowFilter} from '../src/lib/program'
const poll={id:'p',title:'<script>',options:[{id:'a',text:'Yes & no'},{id:'b',text:'B'}],multiple:false,state:'closed' as const,showResults:true,totals:{a:3,b:1},voters:4,voted:[]}
test('poll output escapes content and displays live totals with independent Look toggle',()=>{
  const html=renderPollHTML(poll,DEFAULT_PRESENTATION_SETTINGS.question)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('75%'))
  assert.ok(html.includes('Yes &amp; no'))
  const state={...EMPTY_PROGRAM_STATE,poll}
  const visible=programLayersFor({show:normalizeShowFilter({poll:true,question:false})},state,DEFAULT_PRESENTATION_SETTINGS)
  assert.ok(visible.poll)
  assert.equal(visible.question,'')
  assert.equal(programLayersFor({show:normalizeShowFilter({poll:false})},state,DEFAULT_PRESENTATION_SETTINGS).poll,'')
})
