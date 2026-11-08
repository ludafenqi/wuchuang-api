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
import fs from 'node:fs'
import path from 'node:path'

import { chromium, request } from 'playwright'

// All browser and API traffic targets the packaged gateway container.
const root = process.env.PRODUCT_SHA
const output = path.resolve(process.env.UI_REPORT_DIR)
const origin = process.env.CONTAINER_ORIGIN
assert.match(origin, /^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/)
const backend = origin
const mockOrigin = process.env.MOCK_UPSTREAM_ORIGIN
assert.equal(mockOrigin, 'http://wucora-image-mock:8080')
const assets = 'embedded in container /new-api'
const logoutOnly = false
fs.mkdirSync(output, { recursive: true })

function safeErrorMessage(error) {
  return String(error.message || error)
    .split('\n')[0]
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[redacted JWT]'
    )
}

const results = []
const errors = []
let browser
let stage = 'setup'
try {
  await new Promise((resolve, reject) => {
    const start = Date.now()
    const probe = async () => {
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
          base_url: mockOrigin,
          models: 'gpt-4o-mini',
          group: 'default',
          status: 1,
        },
      },
    })
    .then((response) => response.json())
  assert.ok(channel.success, 'Create the local catalog and affinity fixture')
  stage = 'create-relay-token'
  const tokenCreated = await seed.request
    .post(`${origin}/api/token/`, {
      data: {
        name: 'local-affinity-fixture',
        expired_time: -1,
        unlimited_quota: true,
        group: 'default',
      },
    })
    .then((response) => response.json())
  assert.equal(tokenCreated.success, true, 'Create a disposable relay token')
  const tokens = await seed.request
    .get(`${origin}/api/token/`)
    .then((response) => response.json())
  const tokenID = tokens.data.items.find(
    (item) => item.name === 'local-affinity-fixture'
  )?.id
  assert.equal(typeof tokenID, 'number')
  const relayToken = await seed.request
    .post(`${origin}/api/token/${tokenID}/key`)
    .then((response) => response.json())
  assert.equal(relayToken.success, true)
  const relayKey = relayToken.data.key
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
        errors.push({
          theme,
          width,
          url: page.url(),
          message: safeErrorMessage(error),
        })
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
      if (!logoutOnly) {
        stage = `affinity-${width}-${theme}`
        const routingRoute = '/system-settings/request-policies/routing'
        const headers = { Authorization: `Bearer ${login.data.access_token}` }
        const rules = [
          { name: 'WuCora session', key: 'X-Wucora-Session' },
          { name: 'Other session', key: 'X-Other-Session' },
        ].map(({ name, key }) => ({
          name,
          model_regex: ['^gpt-4o-mini$'],
          path_regex: [],
          key_sources: [{ type: 'request_header', key }],
          ttl_seconds: 3600,
          session_mode: 'prefer',
          include_rule_name: true,
          include_model_name: false,
          include_using_group: false,
        }))
        const configured = await context.request
          .patch(`${origin}/api/option/request_policy`, {
            headers,
            data: {
              options: {
                'channel_affinity_setting.enabled': 'true',
                'channel_affinity_setting.session_mode': 'prefer',
                'channel_affinity_setting.rules': JSON.stringify(rules),
              },
            },
          })
          .then((response) => response.json())
        assert.equal(configured.success, true, 'Save real session rules')
        await context.request.delete(
          `${origin}/api/option/channel_affinity_cache?all=true`,
          { headers }
        )
        for (const key of ['X-Wucora-Session', 'X-Other-Session']) {
          // Tokens stay in memory; request-client failure logs must not expose them.
          const response = await fetch(`${backend}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${relayKey}`,
              'Content-Type': 'application/json',
              [key]: `session-${width}-${theme}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'local fixture' }],
              max_tokens: 8,
            }),
          })
          assert.equal(
            response.status,
            200,
            'Local relay request must create a real session binding'
          )
          assert.equal((await response.json()).object, 'chat.completion')
        }
        await page.goto(origin + routingRoute)
        const clearRule = page.getByRole('button', {
          name: 'Clear cache for WuCora session',
          exact: true,
        })
        const otherRule = page.getByRole('button', {
          name: 'Clear cache for Other session',
          exact: true,
        })
        await clearRule.waitFor()
        const cacheCell = clearRule.locator('xpath=ancestor::td')
        const stats = await context.request
          .get(`${origin}/api/option/channel_affinity_cache`, { headers })
          .then((response) => response.json())
        assert.equal(
          stats.data.by_rule_name['WuCora session'],
          1,
          'First rule has a real cached binding'
        )
        assert.equal(
          stats.data.by_rule_name['Other session'],
          1,
          'Second rule has a real cached binding'
        )
        await cacheCell.getByText('1', { exact: true }).waitFor()
        assert.equal(await clearRule.isEnabled(), true)
        const mutations = []
        const recordMutation = (request) => {
          if (
            request.method() === 'DELETE' &&
            new URL(request.url()).pathname ===
              '/api/option/channel_affinity_cache'
          ) {
            mutations.push(new URL(request.url()).search)
          }
        }
        page.on('request', recordMutation)
        await page
          .getByRole('button', {
            name: 'Refresh cache statistics',
            exact: true,
          })
          .click()
        await clearRule.click()
        const confirmation = page.getByRole('alertdialog', {
          name: 'Confirm clearing cache for this rule',
        })
        await confirmation
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        assert.deepEqual(
          mutations,
          [],
          'Refresh and cancel must leave cache bindings intact'
        )
        await clearRule.click()
        await confirmation
          .getByRole('button', { name: 'Clear cache', exact: true })
          .click()
        await cacheCell.getByText('0', { exact: true }).waitFor()
        await otherRule
          .locator('xpath=ancestor::td')
          .getByText('1', { exact: true })
          .waitFor()
        const afterRuleStats = await context.request
          .get(origin + '/api/option/channel_affinity_cache', { headers })
          .then((response) => response.json())
        assert.equal(afterRuleStats.data.by_rule_name['WuCora session'], 0)
        assert.equal(afterRuleStats.data.by_rule_name['Other session'], 1)
        assert.deepEqual(mutations, ['?rule_name=WuCora+session'])
        await page
          .getByRole('button', { name: 'Clear All Cache', exact: true })
          .click()
        const clearAll = page.getByRole('alertdialog', {
          name: 'Confirm clearing all channel affinity cache',
        })
        assert.equal(
          await clearAll.evaluate(
            (element) =>
              element.getBoundingClientRect().right <= innerWidth + 1 &&
              element.getBoundingClientRect().left >= -1
          ),
          true
        )
        await page.screenshot({
          path: path.join(output, `affinity-confirm-${width}-${theme}.png`),
          fullPage: true,
          animations: 'disabled',
        })
        await clearAll
          .getByRole('button', { name: 'Clear All Cache', exact: true })
          .click()
        await otherRule
          .locator('xpath=ancestor::td')
          .getByText('0', { exact: true })
          .waitFor()
        await page
          .locator('[role="alertdialog"]')
          .waitFor({ state: 'detached' })
        const afterAllStats = await context.request
          .get(origin + '/api/option/channel_affinity_cache', { headers })
          .then((response) => response.json())
        assert.equal(afterAllStats.data.by_rule_name['WuCora session'], 0)
        assert.equal(afterAllStats.data.by_rule_name['Other session'], 0)
        assert.equal(mutations.length, 2)
        page.off('request', recordMutation)
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          true,
          `Session rules overflow at ${width}/${theme}`
        )
        await page.screenshot({
          path: path.join(output, `affinity-rules-${width}-${theme}.png`),
          fullPage: true,
        })
        results.push({
          route: routingRoute,
          bindingCounts: {
            before: [
              stats.data.by_rule_name['WuCora session'],
              stats.data.by_rule_name['Other session'],
            ],
            afterRuleClear: [
              afterRuleStats.data.by_rule_name['WuCora session'],
              afterRuleStats.data.by_rule_name['Other session'],
            ],
            afterClearAll: [
              afterAllStats.data.by_rule_name['WuCora session'],
              afterAllStats.data.by_rule_name['Other session'],
            ],
          },
          theme,
          width,
          status: 'PASS',
          scope:
            'real saved rules and local relay bindings: refresh/cancel preserve both, per-rule clear preserves other binding, clear-all removes it; responsive screenshots',
        })
      }
      if (!logoutOnly) {
        stage = `pricing-${width}-${theme}`
        const pricingRoute = '/system-settings/billing/model-pricing'
        const headers = { Authorization: `Bearer ${login.data.access_token}` }
        const snapshot = await context.request
          .get(`${origin}/api/option/model_pricing?model=gpt-image-2`, {
            headers,
          })
          .then((response) => response.json())
        assert.equal(snapshot.success, true)
        const fixture = await context.request
          .patch(`${origin}/api/option/model_pricing`, {
            headers,
            data: {
              changes: [
                {
                  model_name: 'gpt-image-2',
                  expected_version:
                    snapshot.data.entries[0]?.version ||
                    snapshot.data.empty_version,
                  pricing: { ModelPrice: 0.04 },
                },
              ],
            },
          })
          .then((response) => response.json())
        assert.equal(
          fixture.success,
          true,
          'Seed a saved price in the disposable gateway'
        )
        await page.goto(origin + pricingRoute)
        await page
          .getByPlaceholder('Search models...', { exact: true })
          .fill('gpt-image-2')
        const row = page.getByRole('row').filter({ hasText: 'gpt-image-2' })
        await row
          .getByRole('button', { name: 'Open menu', exact: true })
          .click()
        await page
          .getByRole('menuitem', { name: 'Delete', exact: true })
          .click()
        await row.getByText('Pending deletion', { exact: true }).waitFor()
        await row.getByRole('button', { name: 'Undo', exact: true }).click()
        await row
          .getByRole('button', { name: 'Open menu', exact: true })
          .click()
        await page
          .getByRole('menuitem', { name: 'Delete', exact: true })
          .click()
        const save = page
          .getByRole('button', { name: /Save model prices/ })
          .filter({ visible: true })
          .first()
        await save.click()
        const dialog = page.getByRole('alertdialog', {
          name: 'Confirm price changes',
        })
        await dialog
          .getByText('Remove saved price', { exact: true })
          .filter({ visible: true })
          .waitFor()
        assert.ok(
          await dialog.evaluate(
            (element) =>
              element.getBoundingClientRect().right <= innerWidth + 1 &&
              element.getBoundingClientRect().left >= -1
          ),
          `Price confirmation overflow at ${width}/${theme}`
        )
        await dialog.evaluate(async (element) => {
          await Promise.all(
            element.getAnimations().map((animation) => animation.finished)
          )
        })
        assert.equal(
          await dialog.evaluate((element) => getComputedStyle(element).opacity),
          '1',
          'Capture the settled confirmation, after its enter animation'
        )
        await page.screenshot({
          path: path.join(output, `pricing-confirm-${width}-${theme}.png`),
          fullPage: true,
          animations: 'disabled',
        })
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        const before = await context.request
          .get(`${origin}/api/option/model_pricing?model=gpt-image-2`, {
            headers,
          })
          .then((response) => response.json())
        assert.equal(
          before.data.entries[0].configured.ModelPrice,
          0.04,
          'Cancel must leave the saved price unchanged'
        )
        await save.click()
        const [saved] = await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                '/api/option/model_pricing' &&
              response.request().method() === 'PATCH'
          ),
          dialog
            .getByRole('button', { name: 'Confirm and save', exact: true })
            .click(),
        ])
        assert.equal((await saved.json()).success, true)
        const after = await context.request
          .get(`${origin}/api/option/model_pricing?model=gpt-image-2`, {
            headers,
          })
          .then((response) => response.json())
        assert.equal(
          after.data.entries[0].configured.ModelPrice,
          undefined,
          'Only confirmation removes the saved override'
        )
        results.push({
          route: pricingRoute,
          theme,
          width,
          status: 'PASS',
          scope:
            'real saved price: pending deletion, undo, cancel preserves data, confirmation persists deletion; responsive dialog screenshot',
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
  results.push({
    status: 'FAIL',
    stage,
    message: safeErrorMessage(error),
    actual:
      typeof error.actual === 'number' || typeof error.actual === 'boolean'
        ? error.actual
        : undefined,
    expected:
      typeof error.expected === 'number' || typeof error.expected === 'boolean'
        ? error.expected
        : undefined,
  })
  process.exitCode = 1
} finally {
  await browser?.close()
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        root,
        productSHA: process.env.PRODUCT_SHA,
        productTree: process.env.PRODUCT_TREE,
        workflowSHA: process.env.GITHUB_SHA,
        origin,
        mockOrigin,
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
