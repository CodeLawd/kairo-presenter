// npm run build && electron tests/scripture-lazy-cards.integration.cjs
// Verifies the scripture grid only builds the slides near the viewport, that
// scrolling fills the rest in, and that a non-lazy preview (live output) still
// renders immediately. Synthetic verses; no IPC, no ProPresenter.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lazy-'))
app.setPath('userData', temporary)
let win
const timeout = setTimeout(() => { console.error('Lazy card test timed out'); app.exit(1) }, 120000)

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { VerseCardGrid } from '${path.resolve('src/renderer/src/components/scripture/VerseCardGrid.tsx')}'
import { VerseThemePreview } from '${path.resolve('src/renderer/src/components/scripture/VerseThemePreview.tsx')}'
import { createResultRow } from '${path.resolve('src/renderer/src/components/scripture/types.ts')}'
import { DEFAULT_OVERLAY_SETTINGS } from '${path.resolve('src/lib/overlay-defaults.ts')}'
export { React, createRoot, VerseCardGrid, VerseThemePreview, createResultRow, DEFAULT_OVERLAY_SETTINGS }
`

app.whenReady().then(async () => {
  const entry = path.resolve('.lazy-cards-entry.tsx')
  fs.writeFileSync(entry, ENTRY)
  buildSync({
    entryPoints: [entry],
    outfile: path.join(temporary, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'iife', globalName: 'T',
    jsx: 'automatic', absWorkingDir: path.resolve('.'),
    alias: { '@shared': path.resolve('src/lib'), '@': path.resolve('src/renderer/src') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = fs.readdirSync('out/renderer/assets').find((f) => f.endsWith('.css'))
  fs.copyFileSync(path.join('out/renderer/assets', css), path.join(temporary, 'app.css'))
  fs.writeFileSync(path.join(temporary, 'index.html'),
    `<html><head><link rel="stylesheet" href="./app.css"></head>` +
    `<body style="margin:0"><div id="scroller" style="height:700px;overflow-y:auto"><div id="root"></div></div>` +
    `<script src="./bundle.js"></script></body></html>`)

  win = new BrowserWindow({ show: false, width: 1200, height: 700, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(temporary, 'index.html'))

  const result = await win.webContents.executeJavaScript(`(async () => {
    const { React, createRoot, VerseCardGrid, VerseThemePreview, createResultRow, DEFAULT_OVERLAY_SETTINGS } = T;
    const base = DEFAULT_OVERLAY_SETTINGS.theme;
    // The configuration that made this slow: auto-fit on, image background.
    const theme = { ...base, layout: { ...base.layout, autoFitText: true } };
    const TEXT = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';

    const rows = Array.from({ length: 54 }, (_, i) => createResultRow({
      reference: 'John 3:' + (i + 1), translation: 'NKJV',
      verses: Array.from({ length: 7 }, (_, v) => ({ book: 'John', chapter: 3, verse: v + 1, text: TEXT })),
    }, { id: 'row-' + i, planItemId: 'item-' + i }));

    const scroller = document.getElementById('scroller');
    const host = document.getElementById('root');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // IntersectionObserver delivers asynchronously, so wait for the drawn count
    // to stop changing rather than guessing a frame count.
    const settle = async (read) => {
      let last = -1;
      for (let i = 0; i < 60; i++) {
        await frame();
        const now = read();
        if (now === last) return now;
        last = now;
      }
      return read();
    };

    const reactRoot = createRoot(host);
    reactRoot.render(React.createElement(VerseCardGrid, {
      rows, activeCardIndex: 0, cueHighlight: false, focusHighlight: false,
      cardMinWidth: 288, cardHeight: 162, theme,
      showTranslation: true, showVerseNumbers: true, maxVerses: 0,
      gridRef: { current: null }, cardRefs: { current: [] }, rowRefs: { current: new Map() },
      onSelectCard: () => {},
    }));
    await frame();

    const totalCards = host.querySelectorAll('button').length;
    // A drawn slide is the 1920x1080 subtree; a deferred one has no .pa-verse.
    const drawn = () => host.querySelectorAll('.pa-verse').length;
    const initialDrawn = await settle(drawn);

    scroller.scrollTop = scroller.scrollHeight;
    const afterScrollDrawn = await settle(drawn);

    // Every card keeps its button (and so its size, ref and keyboard target)
    // whether or not its slide is drawn yet.
    const buttonsAfter = host.querySelectorAll('button').length;
    reactRoot.unmount();

    // A non-lazy preview — the live output path — must draw immediately.
    const eagerHost = document.createElement('div');
    document.body.appendChild(eagerHost);
    const eagerRoot = createRoot(eagerHost);
    eagerRoot.render(React.createElement(VerseThemePreview, {
      result: rows[0].cards[0].result, theme, showTranslation: true, showVerseNumbers: true,
      maxVerses: 0, width: 288, height: 162, isFocused: false, isLive: false,
      sendStatus: 'idle', onSelect: () => {}, cardRef: () => {},
    }));
    await frame();
    const eagerDrawn = eagerHost.querySelectorAll('.pa-verse').length;
    eagerRoot.unmount();
    eagerHost.remove();

    return { totalCards, initialDrawn, afterScrollDrawn, buttonsAfter, eagerDrawn };
  })()`)

  const { totalCards, initialDrawn, afterScrollDrawn, buttonsAfter, eagerDrawn } = result
  console.log('total cards:', totalCards)
  console.log('slides drawn on open:', initialDrawn)
  console.log('slides drawn after scrolling to the end:', afterScrollDrawn)
  console.log('non-lazy preview drawn immediately:', eagerDrawn)

  assert.equal(totalCards, 378, '54 items x 7 verses = 378 cards')
  assert.equal(buttonsAfter, totalCards, 'every card keeps its button while deferred')
  assert.ok(initialDrawn > 0, 'the cards on screen must be drawn')
  assert.ok(
    initialDrawn < totalCards,
    `open must defer off-screen slides (drew ${initialDrawn}/${totalCards})`,
  )
  assert.ok(
    afterScrollDrawn > initialDrawn,
    `scrolling must fill in more slides (${initialDrawn} -> ${afterScrollDrawn})`,
  )
  assert.equal(eagerDrawn, 1, 'a non-lazy preview must render without scrolling')

  console.log(`\nPASS: grid defers ${totalCards - initialDrawn}/${totalCards} slides on open, fills in on scroll, live output unaffected.`)
}).catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timeout)
  fs.rmSync(path.resolve('.lazy-cards-entry.tsx'), { force: true })
  win?.destroy()
  app.exit(process.exitCode || 0)
})
