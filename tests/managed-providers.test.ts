import test from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { managedFetch, managedTransport } from '../src/main/services/cloud/managed'
import type { ManagedRequest } from '../src/lib/cloud/licensing'

test('installed SDKs send managed requests without permanent provider credentials', async (t) => {
  const calls: ManagedRequest[] = []
  t.mock.method(managedTransport, 'request', async <T>(request: ManagedRequest): Promise<T> => {
    calls.push(request)
    return (request.provider === 'anthropic' ? { id: 'message', type: 'message', role: 'assistant', content: [{ type: 'text', text: '[]' }], model: 'claude-haiku-4-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } : { id: 'completion', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '[]' } }] }) as T
  })
  const anthropic = new Anthropic({ apiKey: 'never-forward-this', fetch: managedFetch('anthropic') })
  await anthropic.messages.create({ model: 'claude-haiku-4-5', max_tokens: 64, messages: [{ role: 'user', content: 'A scripture citation' }] })
  const deepseek = new OpenAI({ apiKey: 'never-forward-this', baseURL: 'https://api.deepseek.com', fetch: managedFetch('deepseek', 'translation') })
  await deepseek.chat.completions.create({ model: 'deepseek-flash', max_tokens: 64, messages: [{ role: 'user', content: 'Translate a lyric' }] })
  assert.deepEqual(calls.map(call => [call.provider, call.path, call.purpose]), [['anthropic', '/v1/messages', 'scripture'], ['deepseek', '/chat/completions', 'translation']])
  assert.equal(JSON.stringify(calls).includes('never-forward-this'), false)
})

test('managed SDK requests respect cancellation while the gateway is pending', async (t) => {
  t.mock.method(managedTransport, 'request', () => new Promise(() => {}))
  const controller = new AbortController()
  const pending = managedFetch('anthropic')('https://api.anthropic.com/v1/messages', { body: '{}', method: 'POST', signal: controller.signal })
  controller.abort(new DOMException('Stopped', 'AbortError'))
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError')
})
