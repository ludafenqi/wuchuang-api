/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// Run after `bun run build`: node src/styles/__tests__/brand-cascade.browser.mjs
// Uses an installed Chrome (or CHROME_BIN) and the real production stylesheet.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const webRoot = resolve(import.meta.dirname, '../../..')
const dist = join(webRoot, 'dist')
const index = readFileSync(join(dist, 'index.html'), 'utf8')
const stylesheets = [
  ...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g),
]
assert.ok(stylesheets.length > 0, 'Build the frontend before running this test')
const links = stylesheets
  .map(([, href]) => {
    assert.ok(
      !href.includes('://'),
      'Only local build stylesheets may be loaded'
    )
    return `<link rel="stylesheet" href="${pathToFileURL(resolve(dist, href.replace(/^\//, '')))}">`
  })
  .join('\n')
let chrome = process.env.CHROME_BIN
if (!chrome) {
  if (process.platform === 'win32') {
    chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  } else if (process.platform === 'darwin') {
    chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  } else {
    chrome = 'google-chrome'
  }
}
const temporary = mkdtempSync(join(tmpdir(), 'wcai-cascade-'))
try {
  const document = join(temporary, 'test.html')
  writeFileSync(
    document,
    `<!doctype html><html><head>${links}</head><body>
    <div class="wcai-console">
      <div id="normal" data-slot="card" class="ring-1 ring-foreground/10"></div>
      <div id="danger" data-slot="card" class="ring-1 ring-destructive/30"></div>
      <div id="plain" data-slot="card" class="ring-1 ring-foreground/10 shadow-none"></div>
      <div id="border" data-slot="card" class="border border-primary/70"></div>
    </div><pre id="results"></pre>
    <script>addEventListener('load', () => {
      const results = [];
      for (const mode of ['light', 'dark']) {
        document.documentElement.classList.toggle('dark', mode === 'dark');
        const normal = getComputedStyle(document.getElementById('normal')).boxShadow;
        const danger = getComputedStyle(document.getElementById('danger')).boxShadow;
        const plain = getComputedStyle(document.getElementById('plain')).boxShadow;
        const card = document.getElementById('border');
        card.setAttribute('data-slot', 'card');
        const border = getComputedStyle(card).borderColor;
        card.removeAttribute('data-slot');
        results.push({ mode, warningRing: danger !== normal, explicitShadow: plain !== normal, semanticBorder: border === getComputedStyle(card).borderColor });
      }
      document.getElementById('results').textContent = JSON.stringify(results);
    });</script></body></html>`
  )
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--allow-file-access-from-files',
    `--user-data-dir=${join(temporary, 'profile')}`,
    '--dump-dom',
    pathToFileURL(document).href,
  ]
  if (process.getuid?.() === 0) args.unshift('--no-sandbox')
  const browser = spawnSync(chrome, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
  assert.equal(
    browser.status,
    0,
    'Chrome could not run; set CHROME_BIN to an installed Chrome executable'
  )
  const output = browser.stdout.match(/<pre id="results">([^<]+)<\/pre>/)?.[1]
  assert.ok(output, 'Chrome did not return stylesheet regression results')
  const results = JSON.parse(output)
  for (const result of results) {
    assert.ok(
      result.warningRing,
      `${result.mode}: dangerous account action must retain its distinct warning ring`
    )
    assert.ok(
      result.explicitShadow,
      `${result.mode}: explicit no-shadow preference must be respected`
    )
    assert.ok(
      result.semanticBorder,
      `${result.mode}: semantic card border must remain visible`
    )
  }
  process.stdout.write(`${JSON.stringify({ checks: results, total: 6 })}\n`)
} finally {
  const resolved = resolve(temporary)
  assert.ok(
    resolved.startsWith(resolve(tmpdir()) + sep) &&
      resolved.includes('wcai-cascade-')
  )
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  })
}
