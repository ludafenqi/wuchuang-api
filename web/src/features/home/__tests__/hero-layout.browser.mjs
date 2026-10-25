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

// Run against the actual home route at each requested viewport and theme.
// The caller supplies a browser tab or { playwright: page }.
export async function assertHeroWordWrapping(tab) {
  const result = await tab.playwright.evaluate(() => {
    const title = document.querySelector('main h1')
    const main = document.querySelector('main')
    const targets = [...document.querySelectorAll('.wucora-section-index a')]
    const titleRect = title?.getBoundingClientRect()
    const content = [
      ...document.querySelectorAll(
        'main h1, main h2, .wucora-actions a, .wucora-workspace-link, .wucora-model-link'
      ),
    ]
    return {
      found: !!title && !!main,
      width: window.innerWidth,
      titleFits:
        titleRect && titleRect.left >= 0 && titleRect.right <= innerWidth,
      contentFits: content.every((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth + 1
      }),
      targetsExist:
        targets.length === 3 &&
        targets.every(
          (link) => !!document.querySelector(link.getAttribute('href'))
        ),
      mobileIndexStacks:
        innerWidth >= 640 ||
        targets.every(
          (link) => link.getBoundingClientRect().width >= main.clientWidth - 50
        ),
      pageFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    }
  })
  assert.ok(
    result.found,
    'The public home headline must be inside its main landmark'
  )
  assert.ok(
    result.titleFits && result.contentFits,
    'Headings, model links and actions must fit the viewport'
  )
  assert.ok(
    result.targetsExist,
    'Every section shortcut must lead to a real section'
  )
  assert.ok(
    result.mobileIndexStacks,
    'Narrow screens must use a stacked section index'
  )
  assert.ok(result.pageFits, 'The home page must not overflow horizontally')
  return result
}

export async function assertHomeFooterAlignment(tab) {
  const result = await tab.playwright.evaluate(() => {
    const footer = document.querySelector('.wucora-home-footer footer')
    const row = footer?.querySelector('[data-slot="footer-copyright-row"]')
    const copyright = row?.querySelector('p')
    const notice = row?.querySelector('a[href="/open-source"]')
    if (!row || !copyright || !notice) return { found: false }
    const rowRect = row.getBoundingClientRect()
    const copyRect = copyright.getBoundingClientRect()
    const linkRect = notice.getBoundingClientRect()
    const copyStyle = getComputedStyle(copyright)
    const linkStyle = getComputedStyle(notice)
    const sameLine =
      Math.abs(
        (copyRect.top + copyRect.bottom) / 2 -
          (linkRect.top + linkRect.bottom) / 2
      ) <= 1
    return {
      found: true,
      width: innerWidth,
      noticeCount: footer.querySelectorAll('a[href="/open-source"]').length,
      directRowChildren:
        copyright.parentElement === row && notice.parentElement === row,
      leftAligned: Math.abs(copyRect.left - rowRect.left) <= 1,
      rightAligned: Math.abs(linkRect.right - rowRect.right) <= 1,
      sameLine,
      safeWrap: sameLine || linkRect.top >= copyRect.bottom,
      matchingTextMetrics:
        copyStyle.fontSize === linkStyle.fontSize &&
        copyStyle.lineHeight === linkStyle.lineHeight,
      noInnerSeparators: [...row.children].every(
        (el) => Number.parseFloat(getComputedStyle(el).borderTopWidth) === 0
      ),
      fits:
        row.scrollWidth <= row.clientWidth &&
        document.documentElement.scrollWidth <= innerWidth,
    }
  })
  assert.ok(
    result.found,
    'The home footer must contain its copyright and notice entry'
  )
  assert.equal(
    result.noticeCount,
    1,
    'The home footer must have exactly one notice entry'
  )
  assert.ok(
    result.directRowChildren && result.leftAligned && result.rightAligned,
    'Copyright and notice must share a row with opposite alignment'
  )
  assert.ok(
    result.matchingTextMetrics && result.noInnerSeparators,
    'The copyright row must use aligned text without an extra notice separator'
  )
  assert.ok(
    result.fits && result.safeWrap,
    'The copyright row must wrap without horizontal overflow'
  )
  if (result.width >= 768) {
    assert.ok(
      result.sameLine,
      'Desktop and tablet copyright rows must stay on one line'
    )
  }
  return result
}
