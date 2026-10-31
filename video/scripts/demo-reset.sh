#!/bin/sh
# Reset the demo: fresh detector, empty transcript, reloaded renderer and the
# in-memory demo service reopened. Run `demo-sermon.mjs start` once beforehand.
set -e
cd "$(dirname "$0")/.."
node scripts/demo-sermon.mjs reset >/dev/null
node scripts/cdp.mjs eval "location.reload(); 'reloading'" >/dev/null || true
sleep 4
node scripts/cdp.mjs eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /^Operator$/i.test(b.getAttribute('aria-label') || b.dataset.tooltip || '')); b?.click(); return !!b })()" >/dev/null
sleep 1
node scripts/cdp.mjs demo-service
echo "demo reset"
