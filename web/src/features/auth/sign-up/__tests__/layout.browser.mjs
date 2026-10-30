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

export async function assertRegistrationHeadlineLayout(tab, expectedTitle) {
  const result = await tab.playwright.evaluate(() => {
    const title = document.querySelector('.wcai-auth-story h2')
    const form = document.querySelector('.wcai-auth-content')
    if (!title || !form) return { found: false }
    const range = document.createRange()
    range.selectNodeContents(title)
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 0)
    const rect = title.getBoundingClientRect()
    const visible = title.getClientRects().length > 0
    return {
      found: true,
      text: title.textContent,
      width: innerWidth,
      visible,
      lineCount: lines.length,
      explicitBreaks:
        !!title.querySelector('br') || /[\r\n]/.test(title.textContent),
      fits:
        !visible ||
        (title.scrollWidth <= title.clientWidth &&
          rect.left >= 0 &&
          rect.right <= innerWidth),
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      formFits: form.scrollWidth <= form.clientWidth,
    }
  })
  assert.ok(
    result.found,
    'The registration page must keep its brand headline and form'
  )
  assert.equal(result.text, expectedTitle)
  assert.equal(
    result.explicitBreaks,
    false,
    'The registration headline must be one complete sentence'
  )
  assert.ok(
    result.fits && result.pageFits && result.formFits,
    'The registration page must not overflow horizontally'
  )
  assert.equal(
    result.visible,
    result.width >= 1024,
    'Keep the existing desktop-only brand story layout'
  )
  if (result.visible) {
    assert.equal(
      result.lineCount,
      1,
      'The visible registration headline must fit on one line'
    )
  }
  return result
}
