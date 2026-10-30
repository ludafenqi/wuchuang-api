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
// Run against a local UI fixture host after building. PLAYWRIGHT_MODULE may
// point to an existing Playwright installation; BROWSER_BIN selects a browser.
// UI_PREVIEW_URL must serve the sign-in page with local status/auth fixtures.
import assert from 'node:assert/strict'

const origin = new URL(process.env.UI_PREVIEW_URL || 'http://127.0.0.1:5183')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_BIN,
  headless: true,
})
const results = []
try {
  for (const width of [390, 1440]) {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion,
        locale: 'en-US',
      })
      const page = await context.newPage()
      await page.goto(new URL('/sign-in', origin).href)
      const input = page.locator('input[name="password"]')
      await input.fill('local-visual-test-only-long-password-value')
      const toggle = page.getByRole('button', {
        name: 'Show password',
        exact: true,
      })
      const before = await toggle.boundingBox()
      assert.ok(before)
      const textClearance = await input.evaluate((element) => ({
        padding: Number.parseFloat(getComputedStyle(element).paddingInlineEnd),
        right: element.getBoundingClientRect().right,
      }))
      assert.ok(
        textClearance.padding >= textClearance.right - before.x,
        'Long password text must have reserved space for the visibility button'
      )
      const center = {
        x: before.x + before.width / 2,
        y: before.y + before.height / 2,
      }
      await page.mouse.move(center.x, center.y)
      await page.mouse.down()
      const pressed = await toggle.boundingBox()
      assert.ok(pressed)
      assert.ok(
        Math.abs(pressed.y + pressed.height / 2 - center.y) <= 1,
        'Pressing the visibility button must preserve its vertical alignment'
      )
      await page.mouse.up()
      await page.waitForFunction(
        () => document.querySelector('input[name="password"]')?.type === 'text'
      )
      assert.equal(
        await input.inputValue(),
        'local-visual-test-only-long-password-value'
      )
      const hideToggle = page.getByRole('button', {
        name: 'Hide password',
        exact: true,
      })
      await hideToggle.focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () =>
          document.querySelector('input[name="password"]')?.type === 'password'
      )
      assert.equal(
        await input.inputValue(),
        'local-visual-test-only-long-password-value'
      )
      results.push({ width, reducedMotion, passed: true })
      await context.close()
    }
  }
  process.stdout.write(
    `${JSON.stringify({ cases: results, total: results.length })}\n`
  )
} finally {
  await browser.close()
}
