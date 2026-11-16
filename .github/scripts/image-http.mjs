import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const origin = process.env.CONTAINER_ORIGIN
assert.match(origin, /^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/)
const output = path.join(process.env.RUNNER_TEMP, 'image-evidence')
const container = JSON.parse(
  fs.readFileSync(path.join(output, 'container-inspect.json'))
)[0]
const mock = JSON.parse(
  fs.readFileSync(path.join(output, 'mock-container-inspect.json'))
)[0]
const network = JSON.parse(
  fs.readFileSync(path.join(output, 'network-inspect.json'))
)[0]
const identity = JSON.parse(
  fs.readFileSync(path.join(output, 'image-identity.json'))
)
assert.equal(identity.productSHA, process.env.PRODUCT_SHA)
assert.equal(identity.productTree, process.env.PRODUCT_TREE)
assert.equal(identity.workflowSHA, process.env.GITHUB_SHA)
assert.equal(identity.registryDigest, process.env.REGISTRY_DIGEST)
assert.equal(identity.published, true)
assert.equal(identity.rebuilt, false)
assert.equal(identity.imageReference, process.env.IMAGE)
assert.ok(container.Image === identity.configDigest)
assert.ok(identity.platformManifestDigest.startsWith('sha256:'))
assert.equal(container.Image, identity.imageID)
assert.deepEqual(container.Config.Entrypoint, ['/new-api'])
assert.equal(container.HostConfig.Privileged, false)
assert.equal(network.Internal, true)
for (const item of [container, mock]) {
  assert.equal(item.HostConfig.NetworkMode, 'wucora-image-review')
  assert.ok(
    Object.values(item.NetworkSettings.Ports || {}).every(
      (value) => value === null
    )
  )
  assert.equal(Object.keys(item.HostConfig.PortBindings || {}).length, 0)
}
assert.deepEqual(Object.keys(container.HostConfig.Tmpfs || {}), ['/data'])
assert.ok(
  container.Mounts.every(
    (mount) => mount.Type === 'tmpfs' && mount.Destination === '/data'
  )
)
assert.equal((container.HostConfig.Binds || []).length, 0)
const dataMount = fs
  .readFileSync(path.join(output, 'runtime-data-mount.txt'), 'utf8')
  .trim()
  .split(/\s+/)
assert.equal(dataMount[1], '/data')
assert.equal(dataMount[2], 'tmpfs')
const mockAddress =
  mock.NetworkSettings.Networks['wucora-image-review'].IPAddress
const gatewayAddress =
  container.NetworkSettings.Networks['wucora-image-review'].IPAddress
const statsResponse = await fetch(`http://${mockAddress}:8080/stats`)
assert.equal(statsResponse.status, 200)
const stats = await statsResponse.json()
assert.equal(stats.total, 12)
assert.deepEqual(
  stats.callers,
  [gatewayAddress],
  'Only the packaged gateway container called the mock'
)
fs.writeFileSync(
  path.join(output, 'mock-stats.json'),
  JSON.stringify(stats, null, 2)
)
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
const paths = [
  ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g),
].map((m) => m[1])
assert.ok(paths.some((p) => p.includes('.js')))
assert.ok(paths.some((p) => p.includes('.css')))
const assets = []
let wucora = false
let revision = false
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
  assets.push({
    path: url.pathname,
    status: response.status,
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  })
}
assert.ok(wucora, 'Embedded frontend includes WuCora assets')
assert.ok(revision, 'Embedded frontend includes the exact product revision')
const browser = JSON.parse(
  fs.readFileSync(path.join(output, 'browser/result.json'))
)
assert.equal(browser.productSHA, process.env.PRODUCT_SHA)
assert.equal(browser.workflowSHA, process.env.GITHUB_SHA)
assert.equal(browser.registryDigest, process.env.REGISTRY_DIGEST)
assert.equal(browser.imageReference, process.env.IMAGE)
assert.equal(browser.sandbox, true)
assert.equal(browser.results.filter((r) => r.status === 'PASS').length, 61)
assert.equal(browser.results.filter((r) => r.status === 'FAIL').length, 0)
assert.deepEqual(browser.errors, [])
const bindingChecks = browser.results.filter(
  (r) => r.route === '/system-settings/request-policies/routing'
)
assert.equal(bindingChecks.length, 6)
for (const result of bindingChecks) {
  assert.deepEqual(result.bindingCounts.before, [1, 1])
  assert.deepEqual(result.bindingCounts.afterRuleClear, [0, 1])
  assert.deepEqual(result.bindingCounts.afterClearAll, [0, 0])
}
const screenshots = fs
  .readdirSync(path.join(output, 'browser'))
  .filter((name) => name.endsWith('.png'))
assert.equal(screenshots.length, 66)
fs.writeFileSync(
  path.join(output, 'http-contract.json'),
  JSON.stringify(
    {
      registryDigest: process.env.REGISTRY_DIGEST,
      imageReference: process.env.IMAGE,
      published: true,
      rebuilt: false,
      productSHA: process.env.PRODUCT_SHA,
      productTree: process.env.PRODUCT_TREE,
      workflowSHA: process.env.GITHUB_SHA,
      origin,
      status: 200,
      statusSourceRevision: status.data.source_revision,
      assets,
      embeddedWuCora: wucora,
      eagerAssetContainsRevision: revision,
      browserChecks: 61,
      screenshots: 66,
      sandbox: true,
      mockCalls: stats,
      internalNetwork: true,
      publishedHostPorts: false,
      frontendServedBy: 'packaged /new-api HTTP server; no static proxy',
    },
    null,
    2
  )
)
console.log(
  'Packaged image HTTP, isolated mock and 61 sandboxed browser checks passed'
)
