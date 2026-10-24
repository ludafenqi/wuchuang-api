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

// Run in the browser review runtime against the Chinese home page.
// The caller supplies a cua tab with the requested viewport and theme.
export async function assertHeroWordWrapping(tab) {
  const result = await tab.playwright.evaluate(() => {
    const title = document.querySelector('h1')
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
      width: window.innerWidth,
      wordTogether: Math.abs(first.top - second.top) < 1,
      pageFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    }
  })
  assert.ok(result.found, 'The actual Chinese headline must be rendered')
  assert.ok(
    result.wordTogether,
    'The headline must not split 网关 across lines'
  )
  assert.ok(result.pageFits, 'The home page must not overflow horizontally')
  return result
}
