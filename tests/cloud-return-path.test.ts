import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeReturnPath } from '../src/lib/cloud/return-path'

test('return destinations retain pairing codes and discard external or malformed navigation', () => {
  assert.equal(safeReturnPath('/activate?userCode=ABCD-EFGH'), '/activate?userCode=ABCD-EFGH')
  for (const value of ['//evil.test', '/\\evil.test', '/%5cevil.test', 'https://evil.test', 'javascript:alert(1)', '/%0aevil', '/%oops', null]) {
    assert.equal(safeReturnPath(value), '/dashboard')
  }
})
