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

// Run against the real production UI, with the setup guide expanded.
export async function assertConsoleOverviewLayout(tab) {
  const result = await tab.playwright.evaluate(() => {
    const summary = document.querySelector('.wcai-summary')
    const guide = document.querySelector('.wcai-setup-card')
    const cards = [...document.querySelectorAll('.wcai-metric, .wcai-credit')]
    const bounds = cards.map((card) => card.getBoundingClientRect())
    const contentWidth = document.querySelector(
      '[data-slot="sidebar-inset"]'
    ).clientWidth
    const columns = new Set(bounds.map((rect) => Math.round(rect.left))).size
    const legal = document
      .querySelector('#root > aside')
      ?.getBoundingClientRect()
    const content = document
      .querySelector('[data-slot="sidebar-inset"]')
      .getBoundingClientRect()
    return {
      metricsFirst:
        !!summary &&
        !!guide &&
        Boolean(
          summary.compareDocumentPosition(guide) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
      cardsFit:
        bounds.length === 4 &&
        bounds.every(
          (rect) => rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth
        ),
      responsiveColumns: contentWidth < 352 || columns >= 2,
      alignedDesktop:
        contentWidth < 1152 ||
        bounds.every((rect) => Math.abs(rect.top - bounds[0].top) < 1),
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      shellFits: document.documentElement.scrollHeight <= innerHeight,
      contentFits: !legal || content.bottom <= legal.top,
    }
  })
  assert.ok(
    result.metricsFirst,
    'Usage must precede onboarding in reading order'
  )
  assert.ok(result.cardsFit, 'All four summary cards must fit without clipping')
  assert.ok(
    result.responsiveColumns,
    'Tablet layouts must use the available width for metrics'
  )
  assert.ok(result.alignedDesktop, 'Desktop metrics must align in a single row')
  assert.ok(
    result.pageFits,
    'Overview must not introduce horizontal page scrolling'
  )
  assert.ok(
    result.shellFits,
    'The console and legal entry must share one viewport without a second page scrollbar'
  )
  assert.ok(
    result.contentFits,
    'The page content must stop above the legal entry'
  )
  return result
}

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
    ]
    return {
      brandText: brand?.textContent,
      profilePresent: !!header?.querySelector('[data-slot="avatar"]'),
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
  assert.ok(result.profilePresent, 'The profile menu must remain available')
  assert.ok(result.controlsFit, 'Header actions must fit the viewport')
  assert.ok(result.controlsDoNotOverlap, 'Header actions must not overlap')
  return result
}
