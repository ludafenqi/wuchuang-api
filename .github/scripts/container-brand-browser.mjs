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
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { chromium } from 'playwright'

// External verifier: run against the pulled product container; never build or spawn a gateway.
const mode = 'after'
const harnessSHA = process.env.GITHUB_SHA
const sha = process.env.PRODUCT_SHA
assert.match(sha, /^[0-9a-f]{40}$/)
assert.match(harnessSHA, /^[0-9a-f]{40}$/)
assert.notEqual(sha, harnessSHA)
const origin = process.env.BRAND_CONTAINER_ORIGIN
assert.match(origin, /^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/)
const fixtureHost = process.env.BRAND_FIXTURE_HOST
assert.match(fixtureHost, /^172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+$/)
assert.match(process.env.REGISTRY_DIGEST, /^sha256:[0-9a-f]{64}$/)
assert.equal(
  process.env.IMAGE,
  'ghcr.io/ludafenqi/wuchuang-api@' + process.env.REGISTRY_DIGEST
)
const output = path.resolve(process.env.UI_REPORT_DIR)
fs.mkdirSync(output, { recursive: true })
const fixtureBytes = fs.readFileSync(
  process.env.UI_BRAND_CUSTOM_FIXTURE || path.resolve('public/wucora-logo.png')
)
const custom = http.createServer((req, res) => {
  if (req.url === '/wucora-logo.png') {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'max-age=3600',
    })
    res.end(fixtureBytes)
  } else {
    res.writeHead(404, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    })
    res.end()
  }
})
await new Promise((resolve) => custom.listen(0, fixtureHost, resolve))
const customOrigin = `http://${fixtureHost}:${custom.address().port}`
const customLogo = `${customOrigin}/wucora-logo.png`
const customWidth = fixtureBytes.readUInt32BE(16)
const expectedCompact =
  mode === 'after' ? '/wucora-logo-128.webp' : '/wucora-logo.png'
const expectedDecoration =
  mode === 'after' ? '/wucora-logo-192.webp' : '/wucora-logo.png'
const expectedIcon =
  mode === 'after' ? '/wucora-favicon.ico' : '/wucora-logo.png'
const credentials = {
  username: 'brandreview',
  password: 'Disposable-Brand-Only-2026!',
}
const results = [],
  network = [],
  errors = [],
  artifacts = []
let browser, admin
function brandURL(url) {
  return /wucora-logo|wucora-favicon|favicon\.ico|missing-brand/.test(url)
}
async function waitReady() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/setup`)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Gateway readiness timeout')
}
async function checkIcon(page, expected) {
  await page.waitForFunction(
    (target) =>
      document.querySelector('link[rel~="icon"]')?.href ===
      new URL(target, location.href).href,
    expected
  )
}
async function observe(page, label) {
  const session = await page.context().newCDPSession(page)
  await session.send('Network.enable')
  const pending = new Map()
  session.on('Network.requestWillBeSent', (e) => {
    if (brandURL(e.request.url)) {
      pending.set(e.requestId, {
        scenario: label,
        url: e.request.url,
        initiator: e.initiator.type,
        documentURL: e.documentURL,
        resourceType: e.type,
      })
    }
  })
  session.on('Network.requestServedFromCache', (e) => {
    const item = pending.get(e.requestId)
    if (item) item.servedFromCache = true
  })
  session.on('Network.responseReceived', (e) => {
    const item = pending.get(e.requestId)
    if (item) {
      Object.assign(item, {
        status: e.response.status,
        mime: e.response.mimeType,
        fromDiskCache: e.response.fromDiskCache,
        fromServiceWorker: e.response.fromServiceWorker,
        contentType:
          e.response.headers['Content-Type'] ||
          e.response.headers['content-type'],
        cacheControl:
          e.response.headers['Cache-Control'] ||
          e.response.headers['cache-control'],
        contentLength:
          e.response.headers['Content-Length'] ||
          e.response.headers['content-length'],
      })
    }
  })
  session.on('Network.loadingFinished', (e) => {
    const item = pending.get(e.requestId)
    if (item) {
      network.push({ ...item, encodedDataLength: e.encodedDataLength })
      pending.delete(e.requestId)
    }
  })
  session.on('Network.loadingFailed', (e) => {
    const item = pending.get(e.requestId)
    if (item) {
      network.push({ ...item, failed: e.errorText })
      pending.delete(e.requestId)
    }
  })
  page.on('pageerror', (error) =>
    errors.push({ scenario: label, message: error.message })
  )
  return session
}
async function ready(page) {
  await page.waitForLoadState('networkidle')
  await page.locator('#root').filter({ hasText: /\S/ }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  )
}
async function imageInfo(page) {
  return page.locator('img').evaluateAll((images) =>
    images
      .filter((img) => /wucora-logo|missing-brand/.test(img.src))
      .map((img) => {
        const r = img.getBoundingClientRect()
        return {
          src: img.getAttribute('src'),
          currentSrc: img.currentSrc,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          complete: img.complete,
          width: r.width,
          height: r.height,
          visible:
            r.width > 0 &&
            r.height > 0 &&
            getComputedStyle(img).visibility !== 'hidden',
          opacity: getComputedStyle(img).opacity,
          alt: img.alt,
        }
      })
  )
}
async function capture(page, name, scenario) {
  await ready(page)
  const buildRevision = await page
    .locator('html')
    .getAttribute('data-build-rev')
  assert.ok(
    buildRevision?.includes(sha),
    'Embedded frontend matches the product revision'
  )
  const info = await imageInfo(page)
  assert.ok(info.length > 0)
  for (const img of info.filter((x) => x.visible)) {
    assert.ok(
      img.complete && img.naturalWidth > 0,
      `Decoded brand image: ${img.src}`
    )
    assert.equal(img.naturalWidth, img.naturalHeight)
    assert.equal(img.width, img.height)
  }
  if (mode === 'after') {
    assert.ok(
      info.every((x) => new URL(x.currentSrc).pathname !== '/wucora-logo.png')
    )
  }
  const file = `${name}.png`
  await page.screenshot({
    path: path.join(output, file),
    fullPage: true,
    animations: 'disabled',
  })
  artifacts.push(file)
  results.push({
    scenario: scenario.label,
    ...scenario,
    screenshot: file,
    buildRevision,
    route: new URL(page.url()).pathname,
    status: 'PASS',
    images: info,
    favicon: await page.locator('link[rel~="icon"]').getAttribute('href'),
    brandLayoutShifts: await page.evaluate(() => window.__brandShifts || []),
    faviconHistory: await page.evaluate(() => window.__icons || []),
  })
}
try {
  await waitReady()
  // Initialize only the independent disposable branding container.
  const setup = await fetch(origin + '/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...credentials,
      confirmPassword: credentials.password,
      SelfUseModeEnabled: false,
      DemoSiteEnabled: false,
    }),
  }).then((r) => r.json())
  assert.equal(setup.success, true)
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    // Isolate external traffic without request routing, which disables HTTP cache.
    proxy: {
      server: 'http://127.0.0.1:1',
      bypass:
        '127.0.0.1,localhost,' + new URL(origin).hostname + ',' + fixtureHost,
    },
    ...(process.env.UI_BROWSER
      ? { executablePath: process.env.UI_BROWSER }
      : {}),
  })
  const version = browser.version()
  admin = await browser.newContext()
  const login = await admin.request
    .post(`${origin}/api/user/login`, { data: credentials })
    .then((r) => r.json())
  assert.equal(login.success, true)
  const headers = { Authorization: `Bearer ${login.data.access_token}` }
  async function setLogo(value) {
    const result = await admin.request
      .put(`${origin}/api/option/`, { headers, data: { key: 'Logo', value } })
      .then((r) => r.json())
    assert.equal(result.success, true)
  }
  const status = await admin.request
    .get(`${origin}/api/status`)
    .then((r) => r.json())
  assert.equal(status.data.source_revision, sha)
  for (const theme of ['light', 'dark']) {
    for (const spec of [
      { width: 1440, dpr: 1 },
      { width: 1440, dpr: 2 },
      { width: 390, dpr: 2 },
      { width: 390, dpr: 3 },
      { width: 320, dpr: 3 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: spec.width, height: 900 },
        deviceScaleFactor: spec.dpr,
        colorScheme: theme,
        reducedMotion: 'reduce',
      })
      await context.addInitScript(
        ({ theme }) => {
          localStorage.setItem('newapi:default:cache-version', 'default-v1')
          localStorage.setItem('i18nextLng', 'en')
          localStorage.setItem('newapi:theme:v1:mode', theme)
          window.__icons = []
          window.__brandShifts = []
          new MutationObserver(() => {
            const href = document
              .querySelector('link[rel~="icon"]')
              ?.getAttribute('href')
            if (href && window.__icons.at(-1) !== href) {
              window.__icons.push(href)
            }
          }).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['href'],
          })
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (
                !e.hadRecentInput &&
                e.sources?.some((s) =>
                  s.node?.matches?.('img[src*="wucora"],.wucora-aperture-core')
                )
              ) {
                window.__brandShifts.push({ value: e.value })
              }
            }
          }).observe({ type: 'layout-shift', buffered: true })
        },
        { theme }
      )
      const page = await context.newPage(),
        label = `${spec.width}-${theme}-dpr${spec.dpr}`
      await observe(page, label)
      for (const [route, name] of [
        ['/', 'home'],
        ['/sign-in', 'signin'],
      ]) {
        await page.goto(origin + route)
        await checkIcon(page, expectedIcon)
        await capture(page, `${name}-${label}`, { label, theme, ...spec })
        const info = await imageInfo(page)
        assert.ok(
          info.some((x) => new URL(x.currentSrc).pathname === expectedCompact)
        )
        if (route === '/') {
          assert.ok(
            info.some(
              (x) =>
                new URL(x.currentSrc).pathname === expectedDecoration &&
                x.width === (spec.width < 768 ? 42 : 64)
            )
          )
        }
      }
      const logged = await context.request
        .post(`${origin}/api/user/login`, { data: credentials })
        .then((r) => r.json())
      assert.equal(logged.success, true)
      await page.goto(`${origin}/dashboard/overview`)
      await checkIcon(page, expectedIcon)
      await capture(page, `console-${label}`, { label, theme, ...spec })
      if (spec.width < 768) {
        const toggle = page.getByRole('button', {
          name: 'Toggle Sidebar',
          exact: true,
        })
        if (await toggle.count()) {
          await toggle.click()
          await capture(page, `sidebar-${label}`, { label, theme, ...spec })
          await page.keyboard.press('Escape')
        }
      }
      await context.close()
    }
  }
  if (mode === 'after') {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 3,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    await context.addInitScript(() => {
      localStorage.setItem('newapi:default:cache-version', 'default-v1')
      localStorage.setItem('i18nextLng', 'en')
      localStorage.setItem('newapi:theme:v1:mode', 'light')
      window.__icons = []
      new MutationObserver(() => {
        const href = document
          .querySelector('link[rel~="icon"]')
          ?.getAttribute('href')
        if (href && window.__icons.at(-1) !== href) window.__icons.push(href)
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['href'],
      })
    })
    const page = await context.newPage()
    await observe(page, 'cache-and-custom')
    await page.goto(`${origin}/`)
    await ready(page)
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('system-config-storage'))
      state.state.config.logo = '/wucora-logo.png'
      state.state.loadedLogoUrl = '/wucora-logo.png'
      localStorage.setItem('system-config-storage', JSON.stringify(state))
      const status = JSON.parse(localStorage.getItem('status'))
      status.logo = '/wucora-logo.png'
      localStorage.setItem('status', JSON.stringify(status))
    })
    const legacyNetworkStart = network.length
    await page.reload()
    await checkIcon(page, expectedIcon)
    await capture(page, 'cached-legacy-default', {
      label: 'cached-legacy-default',
      width: 1440,
      theme: 'light',
      dpr: 3,
    })
    assert.ok(
      (await page.evaluate(() => window.__icons)).every(
        (x) => x === '/wucora-favicon.ico'
      )
    )
    assert.ok(
      network
        .slice(legacyNetworkStart)
        .every((x) => new URL(x.url).pathname !== '/wucora-logo.png')
    )
    results.push({
      scenario:
        'legacy-persisted-and-status-cache-never-requests-large-default',
      status: 'PASS',
    })
    const logged = await context.request
      .post(`${origin}/api/user/login`, { data: credentials })
      .then((r) => r.json())
    assert.equal(logged.success, true)
    await page.goto(`${origin}/system-settings/site/system-info`)
    await ready(page)
    await page.getByLabel('Logo URL', { exact: true }).fill(customLogo)
    await page
      .getByRole('button', { name: 'Save Changes', exact: true })
      .first()
      .click()
    await checkIcon(page, customLogo)
    await ready(page)
    const customImages = await imageInfo(page)
    assert.ok(
      customImages.some(
        (x) => x.currentSrc === customLogo && x.naturalWidth === customWidth
      )
    )
    await page.screenshot({
      path: path.join(output, 'custom-live-update.png'),
      fullPage: true,
    })
    artifacts.push('custom-live-update.png')
    results.push({
      scenario: 'custom-live-update',
      status: 'PASS',
      configuredLogo: customLogo,
      images: customImages,
      favicon: customLogo,
    })
    await page.reload()
    await checkIcon(page, customLogo)
    await ready(page)
    assert.ok((await imageInfo(page)).some((x) => x.currentSrc === customLogo))
    results.push({
      scenario: 'cached-custom-network-refresh',
      status: 'PASS',
      faviconHistory: await page.evaluate(() => window.__icons),
    })
    await page.getByLabel('Logo URL', { exact: true }).fill('')
    await page
      .getByRole('button', { name: 'Save Changes', exact: true })
      .first()
      .click()
    await checkIcon(page, expectedIcon)
    await ready(page)
    assert.ok(
      (await imageInfo(page)).every(
        (x) => new URL(x.currentSrc).origin === origin
      )
    )
    results.push({
      scenario: 'clear-custom-live-update',
      status: 'PASS',
      images: await imageInfo(page),
      favicon: expectedIcon,
    })
    const missingLogo = `${customOrigin}/missing-brand.png`
    await page.getByLabel('Logo URL', { exact: true }).fill(missingLogo)
    // The default icon and compact logo are already present after clearing the
    // previous logo. Observe the new failure before waiting for their fallback.
    const [missingResponse] = await Promise.all([
      page.waitForResponse((response) => response.url() === missingLogo),
      page
        .getByRole('button', { name: 'Save Changes', exact: true })
        .first()
        .click(),
    ])
    assert.equal(missingResponse.status(), 404)
    await ready(page)
    await page.waitForFunction(
      ({ compact, decoration, icon }) => {
        const images = [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect()
          return (
            /wucora-logo|missing-brand/.test(image.src) &&
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(image).visibility !== 'hidden'
          )
        })
        return (
          document.querySelector('link[rel~="icon"]')?.getAttribute('href') ===
            icon &&
          images.some(
            (image) =>
              image.getAttribute('src') === compact &&
              image.naturalWidth === 128 &&
              getComputedStyle(image).opacity === '1'
          ) &&
          images.every(
            (image) =>
              [compact, decoration].includes(image.getAttribute('src')) &&
              image.complete &&
              image.naturalWidth > 0
          )
        )
      },
      {
        compact: expectedCompact,
        decoration: expectedDecoration,
        icon: expectedIcon,
      }
    )
    const options = await admin.request
      .get(`${origin}/api/option/`, { headers })
      .then((r) => r.json())
    assert.equal(options.data.find((x) => x.key === 'Logo').value, missingLogo)
    const failureImages = await imageInfo(page)
    results.push({
      scenario: 'failed-custom-visible-and-icon-fallback-with-config-retained',
      status: 'PASS',
      images: failureImages,
      favicon: await page.locator('link[rel~="icon"]').getAttribute('href'),
    })
    await page.screenshot({
      path: path.join(output, 'custom-failure-fallback.png'),
      fullPage: true,
    })
    artifacts.push('custom-failure-fallback.png')
    await setLogo('')
    await context.close()
  }
  const probe = await browser.newContext(),
    page = await probe.newPage()
  await observe(page, 'resource-contract')
  await page.goto(`${origin}/`)
  await ready(page)
  const resourcePaths =
    mode === 'after'
      ? [
          '/wucora-logo-128.webp',
          '/wucora-logo-192.webp',
          '/wucora-favicon.ico',
          '/wucora-logo.png',
        ]
      : ['/wucora-logo.png']
  for (const file of resourcePaths) {
    const resource = await page.evaluate(async (file) => {
      const response = await fetch(file)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return {
        file,
        status: response.status,
        type: response.headers.get('content-type'),
        cache: response.headers.get('cache-control'),
        bytes: bytes.length,
        rawBytes: Array.from(bytes),
      }
    }, file)
    assert.equal(resource.status, 200)
    // Hash exact browser-fetched bytes in Node: HTTP Docker IP is not a secure browser origin.
    const actual = Buffer.from(resource.rawBytes)
    delete resource.rawBytes
    resource.sha256 = createHash('sha256').update(actual).digest('hex')
    const expected = execFileSync('git', ['show', sha + ':web/public' + file])
    assert.deepEqual(
      actual,
      expected,
      'Packaged asset equals exact product Git blob: ' + file
    )
    resource.matchesProductGitBlob = true
    if (file.endsWith('.ico')) {
      assert.equal(actual.readUInt16LE(0), 0)
      assert.equal(actual.readUInt16LE(2), 1)
      assert.equal(actual.readUInt16LE(4), 3)
      resource.frames = []
      for (let i = 0; i < 3; i++) {
        const entry = 6 + i * 16,
          offset = actual.readUInt32LE(entry + 12)
        const size = [16, 32, 48][i]
        assert.equal(actual[entry], size)
        assert.equal(actual[entry + 1], size)
        assert.equal(actual.readUInt32BE(offset + 16), size)
        assert.equal(actual.readUInt32BE(offset + 20), size)
        resource.frames.push({ width: size, height: size, embeddedPNG: true })
      }
    }
    let expectedMime = /image\/png/
    if (file.endsWith('.webp')) expectedMime = /image\/webp/
    if (file.endsWith('.ico')) {
      expectedMime = /image\/(x-icon|vnd.microsoft.icon)/
    }
    assert.match(resource.type, expectedMime)
    results.push({ scenario: 'resource-contract', status: 'PASS', ...resource })
  }
  await page.reload()
  await ready(page)
  await probe.close()
  assert.deepEqual(errors, [])
  const cacheHits = network.filter(
    (item) => item.servedFromCache || item.fromDiskCache
  )
  assert.ok(cacheHits.length > 0, 'Real browser HTTP cache is exercised')
  const defaultRequests = network.filter(
    (x) => !['cache-and-custom', 'resource-contract'].includes(x.scenario)
  )
  if (mode === 'after') {
    assert.ok(
      defaultRequests.every(
        (x) => new URL(x.url).pathname !== '/wucora-logo.png'
      )
    )
  }
  fs.writeFileSync(
    path.join(output, 'result.json'),
    `${JSON.stringify(
      {
        mode,
        sourceSHA: sha,
        harnessSHA,
        harnessFileSHA256: createHash('sha256')
          .update(fs.readFileSync(new URL(import.meta.url)))
          .digest('hex'),
        origin,
        customOrigin,
        browser: version,
        sandbox: true,
        servedBy:
          'pulled image /new-api embedded HTTP assets; no rebuild or static proxy',
        results,
        screenshots: artifacts.length,
        artifacts,
        network,
        cacheHits: cacheHits.length,
        errors,
        defaultRequestsNoLegacyPNG: mode === 'after',
        productSHA: sha,
        productTree: process.env.PRODUCT_TREE,
        workflowSHA: harnessSHA,
        imageReference: process.env.IMAGE,
        registryDigest: process.env.REGISTRY_DIGEST,
        published: true,
        rebuilt: false,
      },
      null,
      2
    )}\n`
  )
  console.log(
    JSON.stringify({
      mode,
      sourceSHA: sha,
      passed: results.length,
      screenshots: artifacts.length,
      brandNetworkRequests: network.length,
      errors,
    })
  )
} finally {
  await admin?.close()
  await browser?.close()
  await new Promise((resolve) => custom.close(resolve))
  fs.writeFileSync(
    path.join(output, 'cleanup.json'),
    `${JSON.stringify(
      {
        customServerClosed: !custom.listening,
        browserClosed: !browser?.isConnected(),
        containerCleanup: 'owned by image-preparation.sh finish',
        passed: !custom.listening && !browser?.isConnected(),
      },
      null,
      2
    )}\n`
  )
}
