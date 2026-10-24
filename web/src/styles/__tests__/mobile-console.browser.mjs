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

// Run with a cua tab on the Chinese console overview and local mock branding.
// Assertions protect rendered text and controls rather than CSS class strings.
export async function assertConsoleTitleWrapping(tab) {
  const result = await tab.playwright.evaluate(() => {
    const title = [...document.querySelectorAll('main h3')].find((element) =>
      element.textContent.includes('几分钟内开始使用你的 API 网关')
    )
    const text = title?.firstChild
    const index = text?.textContent?.indexOf('网关') ?? -1
    if (!text || index < 0) return { found: false }
    const range = document.createRange()
    range.setStart(text, index)
    range.setEnd(text, index + 1)
    const first = range.getBoundingClientRect()
    range.setStart(text, index + 1)
    range.setEnd(text, index + 2)
    const second = range.getBoundingClientRect()
    return {
      found: true,
      wordTogether: Math.abs(first.top - second.top) < 1,
      pageFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    }
  })
  assert.ok(result.found, 'The actual overview setup title must be rendered')
  assert.ok(
    result.wordTogether,
    'The setup title must not split 网关 across lines'
  )
  assert.ok(result.pageFits, 'The console page must fit the viewport')
  return result
}

export async function assertConsoleHeaderFits(tab) {
  const result = await tab.playwright.evaluate(() => {
    const header = document.querySelector('header')
    const brand = header?.querySelector('a[href="/"] span')
    const controls = [...(header?.querySelectorAll('button, a') || [])]
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          label:
            element.getAttribute('aria-label') || element.textContent.trim(),
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        }
      })
      .filter((element) => element.width > 0 && element.height > 0)
    const expected = [
      'Toggle Sidebar',
      '搜索',
      '通知',
      '更改语言',
      '打开主题设置',
      'P',
    ]
    return {
      brandText: brand?.textContent,
      fullBrandVisible: !!brand && brand.clientWidth >= brand.scrollWidth,
      controlsPresent: expected.every((name) =>
        controls.some((c) => c.label === name)
      ),
      controlsFit: controls.every(
        (c) =>
          c.left >= 0 &&
          c.right <= innerWidth &&
          c.top >= 0 &&
          c.bottom <= innerHeight
      ),
      controlsDoNotOverlap: controls.every(
        (c, i) => i === 0 || c.left >= controls[i - 1].right - 1
      ),
      controls,
    }
  })
  assert.equal(
    result.brandText,
    'WuCora',
    'Use the existing mock brand fixture'
  )
  assert.ok(
    result.fullBrandVisible,
    'The WuCora name must remain fully visible'
  )
  assert.ok(
    result.controlsPresent,
    'All existing header actions must remain available'
  )
  assert.ok(result.controlsFit, 'Header actions must fit the viewport')
  assert.ok(result.controlsDoNotOverlap, 'Header actions must not overlap')
  return result
}
