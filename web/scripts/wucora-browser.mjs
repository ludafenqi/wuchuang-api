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
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { chromium, request } from 'playwright'

// Runs only against a new, disposable gateway. No remote services or real accounts.
const root = path.resolve('..')
const output = path.resolve(
  process.env.UI_REPORT_DIR || '../.local-tests/ui-regression'
)
const assets = path.resolve(process.env.UI_ASSETS || 'dist')
const logoutOnly = process.env.UI_LOGOUT_ONLY === '1'
fs.mkdirSync(output, { recursive: true })
const runtime = fs.mkdtempSync(path.join(output, 'runtime-'))
const gateway = path.resolve(process.env.UI_GATEWAY || '../new-api')
const server = http.createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const portServer = http.createServer()
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve))
const backendPort = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))
const backend = `http://127.0.0.1:${backendPort}`
const log = fs.openSync(path.join(runtime, 'gateway.log'), 'w')
const app = spawn(gateway, [], {
  cwd: runtime,
  windowsHide: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    PORT: String(backendPort),
    SQLITE_PATH: path.join(runtime, 'isolated.db'),
    SQL_DSN: '',
    LOG_SQL_DSN: '',
    REDIS_CONN_STRING: '',
    SESSION_SECRET: 'disposable-ui-regression-only-20261030',
    GIN_MODE: 'release',
    UPDATE_TASK: 'false',
    GLOBAL_API_RATE_LIMIT_ENABLE: 'false',
    CRITICAL_RATE_LIMIT: '2000',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  },
})
server.on('request', (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = http.request(
      backend + req.url,
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(backend).host },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers)
        upstream.pipe(res)
      }
    )
    proxy.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(proxy)
    return
  }
  let file = path.resolve(
    assets,
    `.${decodeURIComponent(new URL(req.url, origin).pathname)}`
  )
  if (file !== assets && !file.startsWith(assets + path.sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(assets, 'index.html')
  }
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    }[path.extname(file)] || 'application/octet-stream'
  )
  fs.createReadStream(file)
    .on('error', () => {
      res.statusCode = 503
      res.end('Build artifact unavailable')
    })
    .pipe(res)
})
const results = []
const errors = []
let browser
try {
  await new Promise((resolve, reject) => {
    const start = Date.now()
    const probe = async () => {
      if (app.exitCode !== null) {
        reject(new Error(`Gateway exited: ${app.exitCode}`))
        return
      }
      try {
        if ((await fetch(`${backend}/api/setup`)).ok) {
          resolve()
          return
        }
      } catch {
        /* wait for readiness */
      }
      if (Date.now() - start > 60000) {
        reject(new Error('Gateway readiness timeout'))
        return
      }
      setTimeout(probe, 200)
    }
    void probe()
  })
  const credentials = {
    username: 'uiregression',
    password: 'Disposable-UI-Only-2026!',
  }
  const setup = await fetch(`${backend}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...credentials,
      confirmPassword: credentials.password,
      SelfUseModeEnabled: false,
      DemoSiteEnabled: false,
    }),
  }).then((r) => r.json())
  assert.ok(setup.success, JSON.stringify(setup))
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.UI_BROWSER
      ? { executablePath: process.env.UI_BROWSER }
      : {}),
  })
  const seed = await browser.newContext()
  const seedLogin = await seed.request
    .post(`${origin}/api/user/login`, { data: credentials })
    .then((response) => response.json())
  assert.ok(seedLogin.success)
  await seed.setExtraHTTPHeaders({
    Authorization: `Bearer ${seedLogin.data.access_token}`,
  })
  const channel = await seed.request
    .post(`${origin}/api/channel`, {
      data: {
        mode: 'single',
        channel: {
          type: 1,
          name: 'LOCAL UI FIXTURE',
          key: 'sk-fictional-ui-only',
          base_url: 'http://127.0.0.1:1',
          models: 'gpt-4o-mini',
          group: 'default',
          status: 1,
        },
      },
    })
    .then((response) => response.json())
  assert.ok(channel.success, 'Create the uncontacted local catalog fixture')
  await seed.close()
  for (const theme of logoutOnly ? ['light'] : ['light', 'dark']) {
    for (const width of logoutOnly ? [1440] : [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      })
      await context.addInitScript((mode) => {
        localStorage.setItem('i18nextLng', 'en')
        localStorage.setItem('newapi:theme:v1:mode', mode)
      }, theme)
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort()
      )
      const page = await context.newPage()
      page.on('pageerror', (error) =>
        errors.push({ theme, width, url: page.url(), message: error.message })
      )
      for (const route of logoutOnly
        ? []
        : ['/', '/sign-in', '/sign-up', '/pricing', '/about']) {
        await page.goto(origin + route)
        await page.waitForLoadState('networkidle')
        await page.locator('#root').filter({ hasText: /\S/ }).waitFor()
        await page.evaluate(() => document.fonts.ready)
        assert.equal(new URL(page.url()).pathname, route)
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          `${route} overflow at ${width}/${theme}`
        )
        if (route === '/') assert.ok(await page.locator('main h1').isVisible())
        if (route === '/pricing') {
          await page.getByText('gpt-4o-mini', { exact: true }).first().waitFor()
        }
        if (route === '/sign-in') {
          await page
            .getByRole('button', { name: 'Show password', exact: true })
            .click()
          assert.equal(
            await page
              .getByPlaceholder('Enter password', { exact: true })
              .getAttribute('type'),
            'text'
          )
          await page
            .getByRole('button', { name: 'Hide password', exact: true })
            .click()
        }
        await page.screenshot({
          path: path.join(
            output,
            `${route.replaceAll('/', '_') || 'home'}-${width}-${theme}.png`
          ),
          fullPage: true,
        })
        results.push({
          route,
          theme,
          width,
          status: 'PASS',
          scope: 'real gateway, anonymous layout',
        })
      }
      await page.goto(`${origin}/keys`)
      await page.waitForURL('**/sign-in**')
      const login = await context.request
        .post(`${origin}/api/user/login`, { data: credentials })
        .then((r) => r.json())
      assert.ok(login.success, 'Fixture sign-in must succeed')
      for (const route of logoutOnly
        ? ['/dashboard/overview']
        : [
            '/dashboard/overview',
            '/models/metadata',
            '/system-settings/site/footer',
          ]) {
        await page.goto(origin + route)
        await page.waitForLoadState('networkidle')
        assert.equal(new URL(page.url()).pathname, route.split('?')[0])
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          `${route} overflow at ${width}/${theme}`
        )
        await page.locator('header').first().waitFor()
        assert.ok(await page.locator('header').first().isVisible())
        await page.screenshot({
          path: path.join(
            output,
            `${route.split('?')[0].replaceAll('/', '_')}-${width}-${theme}.png`
          ),
          fullPage: true,
        })
        results.push({
          route,
          theme,
          width,
          status: 'PASS',
          scope: 'real local account, authenticated layout',
        })
      }
      if (width === 1440 && theme === 'light') {
        let replay
        let replayStage = 'browser-session-snapshot'
        try {
          // Capture the actual browser session after its latest bootstrap.
          // Keep all credentials in memory, including on assertion failures.
          const [response] = await Promise.all([
            page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === '/api/user/auth/refresh' &&
                response.request().method() === 'POST'
            ),
            page.reload(),
          ])
          assert.equal(response.status(), 200)
          const bundle = (await response.json()).data
          const sid = bundle?.session?.sid
          assert.equal(typeof sid === 'string' && sid.length > 0, true)
          const cookie = (
            await context.cookies(`${origin}/api/user/auth/refresh`)
          ).find((entry) => entry.name === 'new_api_refresh')
          assert.equal(Boolean(cookie?.value), true)
          replay = await request.newContext({
            baseURL: origin,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extraHTTPHeaders: {
              Cookie: `${cookie.name}=${cookie.value}`,
              'X-Auth-Session': sid,
            },
          })
          // Exercise exactly the frozen cookie before logout. Refresh rotates
          // it; give the new cookie back to the browser for its real UI logout.
          replayStage = 'saved-refresh-valid-before-logout'
          const validRefresh = await replay.post('/api/user/auth/refresh')
          assert.equal(validRefresh.status(), 200)
          const refreshed = await validRefresh.json()
          assert.equal(refreshed.success, true)
          assert.equal(refreshed.data?.session?.sid === sid, true)
          assert.equal(
            refreshed.data.access_expires_at > Date.now() / 1000 + 60,
            true
          )
          await context.addCookies((await replay.storageState()).cookies)
          const accessHeaders = {
            Authorization: `Bearer ${refreshed.data.access_token}`,
          }
          replayStage = 'saved-access-valid-before-logout'
          const validAccess = await replay.get('/api/option/', {
            headers: accessHeaders,
          })
          assert.equal(validAccess.status(), 200)
          assert.equal((await validAccess.json()).success, true)
          replayStage = 'normal-ui-logout'
          await page
            .locator('header button')
            .filter({ has: page.locator('[data-slot="avatar"]') })
            .click()
          await page
            .getByRole('menuitem', { name: 'Sign out', exact: true })
            .click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Sign out', exact: true })
            .click()
          await page.waitForURL('**/sign-in**')
          assert.equal(await page.locator('.wcai-console').count(), 0)
          // Probe access first: replaying a rotated refresh cookie must not
          // itself revoke a still-active session and hide a broken logout.
          replayStage = 'saved-access-rejected-after-logout'
          const deniedAccess = await replay.get('/api/option/', {
            headers: accessHeaders,
          })
          assert.equal(deniedAccess.status(), 401)
          assert.equal((await deniedAccess.json()).code, 'AUTH_SESSION_REVOKED')
          replayStage = 'saved-refresh-rejected-after-logout'
          const deniedRefresh = await replay.post('/api/user/auth/refresh')
          assert.equal(deniedRefresh.status(), 401)
          assert.equal(
            (await deniedRefresh.json()).code,
            'AUTH_SESSION_REVOKED'
          )
          replayStage = 'protected-route-reentry'
          await page.goto(`${origin}/dashboard/overview`)
          await page.waitForURL('**/sign-in**')
          results.push({
            route: '/sign-out',
            theme,
            width,
            status: 'PASS',
            scope:
              'credentials valid before logout; frozen access token and refresh cookie rejected as revoked after UI logout; authenticated DOM removed; protected route denied',
            sessionReplay: {
              sameSession: true,
              beforeLogout: {
                refresh: validRefresh.status(),
                access: validAccess.status(),
              },
              afterLogout: {
                access: deniedAccess.status(),
                refresh: deniedRefresh.status(),
                code: 'AUTH_SESSION_REVOKED',
              },
              accessCheckedBeforeRefreshReplay: true,
            },
          })
        } catch {
          // Playwright request errors can include headers in their call log.
          throw new Error(
            `Logout regression failed at ${replayStage}; credentials omitted`
          )
        } finally {
          await replay?.dispose()
        }
      }
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
} catch (error) {
  results.push({ status: 'FAIL', message: error.stack })
  process.exitCode = 1
} finally {
  await browser?.close()
  app.kill()
  server.close()
  fs.closeSync(log)
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        root,
        assets,
        browser: process.env.UI_BROWSER || 'playwright Chromium',
        check: logoutOnly ? 'logout' : 'full',
        sandbox: true,
        results,
        errors,
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      passed: results.filter((r) => r.status === 'PASS').length,
      failures: results.filter((r) => r.status === 'FAIL'),
      output,
    })
  )
}
