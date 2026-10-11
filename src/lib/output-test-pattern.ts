import { escapeHtml } from './overlay-template'
import type { VideoTestPattern } from './video-devices'

/** Diagnostic layer sits above live content; removing it reveals the current program. */
export function outputTestPatternHTML(pattern: VideoTestPattern, name: string): string {
  const colors = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff']
  const body = pattern === 'bars'
    ? `<div style="display:flex;height:72%">${colors.map(color => `<div style="background:${color};flex:1"></div>`).join('')}</div><div style="height:28%;background:linear-gradient(to right,#000,#fff)"></div>`
    : pattern === 'text'
      ? '<div style="padding:6%;line-height:1.5"><div style="font-size:64px">Kairo · Fine text and alignment</div><div style="font-size:36px">ABCDEFGHIJKLMNOPQRSTUVWXYZ · 0123456789</div><div style="font-size:24px">White text · sharp edges · even horizontal lines</div><div style="margin-top:40px;height:180px;background:repeating-linear-gradient(to bottom,#fff 0px,#fff 1px,#000 1px,#000 4px)"></div></div>'
      : '<style>@keyframes kairo-diagnostic-sweep{from{transform:translateX(0)}to{transform:translateX(1800px)}}</style><div style="position:absolute;left:0;top:0;width:120px;height:100%;background:#fff;animation:kairo-diagnostic-sweep 3s linear infinite alternate"></div><div style="position:absolute;inset:0;background:repeating-linear-gradient(to right,transparent 0,transparent 119px,#475569 119px,#475569 120px)"></div>'
  return `<div id="kairo-diagnostic-pattern" style="position:fixed;inset:0;z-index:2147483647;background:#000;color:#fff;font-family:Arial,sans-serif;overflow:hidden;pointer-events:none">${body}<div style="position:absolute;bottom:24px;left:24px;padding:12px 18px;background:#000;color:#fff;font-size:24px">${escapeHtml(name)} · ${pattern === 'bars' ? 'Color bars' : pattern === 'text' ? 'Fine text' : 'Motion'} test</div></div>`
}
