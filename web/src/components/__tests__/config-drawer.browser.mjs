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

// Run in the browser review runtime on a Chinese console page.
// Reuses the actual ConfigDrawer and its existing keyboard dismissal.
export async function assertThemeDrawerAccessible(tab) {
  const trigger = tab.playwright.getByRole('button', {
    name: '打开主题设置',
    exact: true,
  })
  assert.ok(
    await trigger.isVisible(),
    'Theme settings must be accessible on mobile'
  )
  await trigger.click()
  const dialog = tab.playwright.getByRole('dialog', {
    name: '主题设置',
    exact: true,
  })
  await dialog.waitFor({ state: 'visible' })
  const result = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      width: window.innerWidth,
      fits: bounds.left >= 0 && bounds.right <= window.innerWidth + 1,
    }
  })
  assert.ok(result.fits, 'The existing theme drawer must fit the viewport')
  await dialog.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  return result
}
