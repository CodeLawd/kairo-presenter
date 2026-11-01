import { audiencePhoneApiBase } from '../website/src/app/q/api-base'
import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceApiBaseUrl, audienceRoomError } from '../src/lib/audience-connection'

test('local room creation and sockets use the Worker while normal API stays on Nest', () => {
  assert.equal(audienceApiBaseUrl('http://localhost:3000'), 'http://localhost:8787')
  assert.equal(audienceApiBaseUrl('http://127.0.0.1:3000'), 'http://localhost:8787')
  assert.equal(audienceApiBaseUrl('http://localhost:8899'), 'http://localhost:8899')
  assert.equal(audienceApiBaseUrl('https://api.kairopresenter.com'), 'https://api.kairopresenter.com')
  assert.equal(audienceApiBaseUrl('http://localhost:3000', 'http://localhost:8899'), 'http://localhost:8899')
})

test('room failures preserve structured API messages before Electron serializes them', () => {
  assert.equal(audienceRoomError({ status: 403, message: 'Activate this device first.' }, false), 'Activate this device first.')
  assert.match(audienceRoomError({ status: 404, message: 'Cannot POST /v1/audience/rooms' }, true), /bun run start:dev/)
  assert.match(audienceRoomError({ status: null, message: 'Could not reach Kairo.' }, true), /local Audience service/)
  assert.doesNotMatch(audienceRoomError({ status: 404, message: 'Cannot POST /v1/audience/rooms' }, false), /Cannot POST|\[object Object\]/)
})


test('local phone pages use local rooms while public pages use the hosted API', () => {
  assert.equal(audiencePhoneApiBase('localhost'), 'http://localhost:8787')
  assert.equal(audiencePhoneApiBase('127.0.0.1'), 'http://127.0.0.1:8787')
  assert.equal(audiencePhoneApiBase('kairopresenter.com'), 'https://api.kairopresenter.com')
  assert.equal(audiencePhoneApiBase('localhost', 'https://qa.example.com/'), 'https://qa.example.com')
})
