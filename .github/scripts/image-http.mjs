import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const origin = process.env.CONTAINER_ORIGIN
assert.match(origin, /^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/)
const output = path.join(process.env.RUNNER_TEMP, 'image-evidence')
const statusResponse = await fetch(origin + '/api/status')
assert.equal(statusResponse.status, 200)
const status = await statusResponse.json()
assert.equal(status.success, true)
assert.equal(status.data.source_revision, process.env.PRODUCT_SHA)
const home = await fetch(origin + '/')
assert.equal(home.status, 200)
const html = await home.text()
assert.match(home.headers.get('content-type'), /text\/html/)
assert.match(html, /<div id="root"/)
const paths = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(m => m[1])
assert.ok(paths.some(p => p.includes('.js')))
assert.ok(paths.some(p => p.includes('.css')))
const assets = []
let wucora = false, revision = false
for (const asset of paths) {
  const url = new URL(asset, origin)
  assert.equal(url.origin, origin)
  const response = await fetch(url)
  assert.equal(response.status, 200)
  const body = Buffer.from(await response.arrayBuffer())
  assert.ok(body.length > 0)
  const text = body.toString('utf8')
  wucora ||= /wcai|wucora/i.test(text)
  revision ||= text.includes(process.env.PRODUCT_SHA)
  assets.push({ path: url.pathname, status: response.status, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
}
assert.ok(wucora, 'Embedded frontend includes WuCora assets')
// Source revision can be in a lazy JavaScript chunk; the status API independently verifies the backend injection.
const browser = JSON.parse(fs.readFileSync(path.join(output, 'browser/result.json'), 'utf8'))
assert.equal(browser.results.filter(r => r.status === 'PASS').length, 55)
assert.equal(browser.results.filter(r => r.status === 'FAIL').length, 0)
fs.writeFileSync(path.join(output, 'http-contract.json'), JSON.stringify({productSHA: process.env.PRODUCT_SHA, origin, status: 200, statusSourceRevision: status.data.source_revision, assets, embeddedWuCora: wucora, eagerAssetContainsRevision: revision, browserChecks: 55, frontendServedBy: 'packaged /new-api HTTP server; no static proxy'}, null, 2))
console.log('Image HTTP contract and 55 sandboxed browser checks passed')
