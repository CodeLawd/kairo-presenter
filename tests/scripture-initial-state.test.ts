import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Scripture from '../src/renderer/src/components/scripture/Scripture'

test('does not show the NKJV API-key warning while translations are loading', () => {
  Object.assign(globalThis, { React })
  const markup = renderToStaticMarkup(React.createElement(Scripture))

  assert.doesNotMatch(markup, /NKJV is the default/)
})
