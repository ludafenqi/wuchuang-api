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

// Run with a cua browser tab at the desktop, tablet and phone viewports.
// This checks rendered geometry; jsdom cannot detect squeezed page titles.
export async function assertResponsiveShell(tab) {
  const result = await tab.playwright.evaluate(() => {
    const title = document.querySelector('.wcai-page-heading h2')
    const panel = title?.closest('.wcai-page-heading')
    const actions = title?.parentElement?.nextElementSibling
    const titleBox = title?.getBoundingClientRect()
    const actionsBox = actions?.getBoundingClientRect()
    return {
      width: window.innerWidth,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      paneWidth: panel?.clientWidth,
      titleWidth: titleBox?.width,
      titleVisible: !title || Boolean(titleBox?.height),
      actionsBelowTitle: !actions || actionsBox.top >= titleBox.bottom,
      metricHeights: [
        ...document.querySelectorAll('.wcai-usage-metrics .wcai-stat-card'),
      ].map((metric) => metric.getBoundingClientRect().height),
    }
  })
  assert.ok(result.pageFits, 'The page must not overflow horizontally')
  assert.ok(result.titleVisible, 'The page title must remain visible')
  if (result.paneWidth && result.paneWidth < 768) {
    assert.ok(
      result.titleWidth >= Math.min(200, result.paneWidth - 32),
      'Actions must not squeeze the page title into a narrow column'
    )
    assert.ok(
      result.actionsBelowTitle,
      'Narrow content panes must stack page actions below the title'
    )
  }
  if (result.width <= 390) {
    for (const height of result.metricHeights) {
      assert.ok(
        height < 200,
        'Supporting phone metrics must use a compact row layout'
      )
    }
  }
  return result
}
