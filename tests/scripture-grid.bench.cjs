// npm run build && electron tests/scripture-grid.bench.cjs
// Times a real React mount of VerseCardGrid — the work a playlist open does
// after its data is resolved. Synthetic verses; no IPC, no ProPresenter.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-grid-'))
app.setPath('userData', temporary)
let win
const timeout = setTimeout(() => { console.error('Bench timed out'); app.exit(1) }, 180000)

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { VerseCardGrid } from '${path.resolve('src/renderer/src/components/scripture/VerseCardGrid.tsx')}'
import { createResultRow } from '${path.resolve('src/renderer/src/components/scripture/types.ts')}'
import { DEFAULT_OVERLAY_SETTINGS } from '${path.resolve('src/lib/overlay-defaults.ts')}'
export { React, createRoot, VerseCardGrid, createResultRow, DEFAULT_OVERLAY_SETTINGS }
`

app.whenReady().then(async () => {
  const entry = path.resolve('.bench-grid-entry.tsx')
  fs.writeFileSync(entry, ENTRY)
  buildSync({
    entryPoints: [entry],
    outfile: path.join(temporary, 'bench.js'),
    bundle: true, platform: 'browser', format: 'iife', globalName: 'Bench',
    jsx: 'automatic',
    absWorkingDir: path.resolve('.'),
    alias: { '@shared': path.resolve('src/lib'), '@': path.resolve('src/renderer/src') },
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = fs.readdirSync('out/renderer/assets').find((f) => f.endsWith('.css'))
  fs.copyFileSync(path.join('out/renderer/assets', css), path.join(temporary, 'app.css'))
  fs.writeFileSync(path.join(temporary, 'index.html'),
    `<html><head><link rel="stylesheet" href="./app.css"><script src="./bench.js"></script></head><body style="height:900px;overflow:auto"><div id="root"></div></body></html>`)

  win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(temporary, 'index.html'))

  const result = await win.webContents.executeJavaScript(`(async () => {
    const { React, createRoot, VerseCardGrid, createResultRow, DEFAULT_OVERLAY_SETTINGS } = Bench;
    const base = DEFAULT_OVERLAY_SETTINGS.theme;
    const theme = base;

    // A real 1280x720 JPEG and a real MP4, inlined, so each card decodes actual
    // media exactly as it would with a themed background.
    const makeImage = () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, '#123'); grad.addColorStop(1, '#c51');
      g.fillStyle = grad; g.fillRect(0, 0, 1280, 720);
      for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(Math.random()*1280, Math.random()*720, 6, 6); }
      return c.toDataURL('image/jpeg', 0.85);
    };
    const IMAGE_URL = makeImage();

    const themed = (type, url, autoFit) => ({
      ...base,
      layout: { ...base.layout, autoFitText: Boolean(autoFit) },
      background: url
        ? { ...base.background, type, mediaPath: url, opacity: 1, mediaFit: 'cover' }
        : { ...base.background, type: 'transparent' },
    });

    const TEXT = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';

    // versesPerItem mirrors a playlist of ranges: each verse becomes one card.
    const makeRows = (items, versesPerItem) =>
      Array.from({ length: items }, (_, i) =>
        createResultRow({
          reference: 'John 3:' + (i + 1),
          translation: 'KJV',
          verses: Array.from({ length: versesPerItem }, (_, v) => ({
            book: 'John', chapter: 3, verse: i * versesPerItem + v + 1, text: TEXT,
          })),
        }, { id: 'row-' + i, planItemId: 'item-' + i }));

    // The real playlist this is chasing: 54 items, 360 verse cards.
    const REAL = [5,17,5,6,2,3,2,12,13,28,1,6,7,5,6,10,14,6,20,24,5,27,14,14,1,1,2,4,1,1,2,3,3,4,5,7,4,1,9,7,1,7,2,2,7,7,2,2,5,4,1,6,5,2];
    const realRows = REAL.map((n, i) => createResultRow({
      reference: 'John 3:' + (i + 1), translation: 'NKJV',
      verses: Array.from({ length: n }, (_, v) => ({ book: 'John', chapter: 3, verse: v + 1, text: TEXT })),
    }, { id: 'row-' + i, planItemId: 'item-' + i }));

    const root = document.getElementById('root');
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const mount = async (rows, useTheme) => {
      root.innerHTML = '';
      const host = document.createElement('div');
      root.appendChild(host);
      const reactRoot = createRoot(host);
      const cardRefs = { current: [] };
      const rowRefs = { current: new Map() };
      const t0 = performance.now();
      reactRoot.render(React.createElement(VerseCardGrid, {
        rows, activeCardIndex: 0, cueHighlight: false, focusHighlight: false,
        cardMinWidth: 288, cardHeight: 162, theme: useTheme ?? theme,
        showTranslation: true, showVerseNumbers: true, maxVerses: 0,
        gridRef: { current: null }, cardRefs, rowRefs,
        onSelectCard: () => {},
      }));
      // Two frames: React commit + the ResizeObserver/setScale pass it triggers.
      await nextFrame();
      const dt = performance.now() - t0;
      const cards = host.querySelectorAll('button').length;
      reactRoot.unmount();
      return { dt: +dt.toFixed(1), cards };
    };

    const median = (xs) => { const s = [...xs].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
    const out = [];
    for (const [items, versesPerItem] of [[10,1],[50,1],[50,5],[100,5],[50,10],[100,10]]) {
      const rows = makeRows(items, versesPerItem);
      await mount(rows);                    // warm up JIT + fonts
      const runs = [];
      let cards = 0;
      for (let i = 0; i < 5; i++) { const r = await mount(rows); runs.push(r.dt); cards = r.cards; }
      out.push({ label: 'transparent bg', items, versesPerItem, cards, ms: median(runs), min: Math.min(...runs), max: Math.max(...runs) });
    }

    // The user's real playlist under each theme combination. autoFitText was the
    // variable the earlier runs missed: it defaults to false, but this user has
    // it ON, which turns on a per-card binary-search font fit.
    const combos = [
      ['plain (autofit off)',      themed('transparent', null,      false)],
      ['image bg (autofit off)',   themed('image',       IMAGE_URL, false)],
      ['autofit on, no bg',        themed('transparent', null,      true)],
      ['autofit on + image bg',    themed('image',       IMAGE_URL, true)],
    ];
    for (const [label, t] of combos) {
      await mount(realRows, t);
      const runs = []; let cards = 0;
      for (let i = 0; i < 3; i++) { const r = await mount(realRows, t); runs.push(r.dt); cards = r.cards; }
      out.push({ label, items: 54, versesPerItem: '-', cards, ms: median(runs), min: Math.min(...runs), max: Math.max(...runs) });
    }
    return out;
  })()`)

  console.log('\n=== VerseCardGrid React mount ===')
  console.log('background      | items | verses/item | cards | median ms | min | max | ms/card')
  for (const r of result) {
    console.log(
      String(r.label).padEnd(15), '|',
      String(r.items).padStart(5), '|',
      String(r.versesPerItem).padStart(11), '|',
      String(r.cards).padStart(5), '|',
      String(r.ms).padStart(9), '|',
      String(r.min).padStart(5), '|',
      String(r.max).padStart(5), '|',
      (r.ms / Math.max(1, r.cards)).toFixed(2).padStart(7),
    )
  }
  console.log('\nJSON:', JSON.stringify(result))
}).catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timeout)
  fs.rmSync(path.resolve('.bench-grid-entry.tsx'), { force: true })
  win?.destroy()
  app.exit(process.exitCode || 0)
})
