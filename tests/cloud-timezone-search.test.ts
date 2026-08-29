import assert from 'node:assert/strict'
import test from 'node:test'

import { matchTimezones, normalizeZone, zoneCity } from '../src/lib/cloud/timezone-search'

const ZONES = [
  'Africa/Lagos',
  'America/Argentina/La_Rioja',
  'America/Los_Angeles',
  'America/New_York',
  'Asia/Manila',
  'Europe/London',
  'Pacific/Auckland',
  'UTC',
]

test('a zone is matched the way it is spoken, not the way it is stored', () => {
  assert.equal(normalizeZone('America/New_York'), 'america new york')
  assert.equal(zoneCity('America/Argentina/La_Rioja'), 'la rioja')
})

test('underscores, slashes and hyphens in the query are all forgiven', () => {
  for (const query of ['new york', 'New_York', 'new-york', ' NEW  YORK ']) {
    assert.deepEqual(matchTimezones(ZONES, query), ['America/New_York'], query)
  }
})

test('a city that starts with the query outranks one that merely contains it', () => {
  // "la" opens La_Rioja and Lagos; Lagos and Los_Angeles must not be buried.
  assert.equal(matchTimezones(ZONES, 'lagos')[0], 'Africa/Lagos')
  assert.equal(matchTimezones(ZONES, 'lon')[0], 'Europe/London')
})

test('a region name still finds its zones', () => {
  assert.deepEqual(matchTimezones(ZONES, 'africa'), ['Africa/Lagos'])
  assert.equal(matchTimezones(ZONES, 'america').length, 3)
})

test('no match is an empty list, never the whole world', () => {
  assert.deepEqual(matchTimezones(ZONES, 'zzzz'), [])
})

test('an empty query keeps the caller ordering so the detected zone stays first', () => {
  assert.deepEqual(matchTimezones(ZONES, '   ').slice(0, 2), ['Africa/Lagos', 'America/Argentina/La_Rioja'])
})

test('results are capped so the list can never render four hundred rows', () => {
  const many = Array.from({ length: 500 }, (_, i) => `Etc/Zone_${i}`)
  assert.equal(matchTimezones(many, 'zone', 25).length, 25)
  assert.equal(matchTimezones(many, '').length, 80)
})
