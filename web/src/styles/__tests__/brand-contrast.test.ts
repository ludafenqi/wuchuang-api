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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const theme = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')

function luminance(hex: string): number {
  const components = hex.match(/[a-f\d]{2}/gi)
  if (!components || components.length !== 3) {
    throw new Error('Invalid RGB color')
  }
  const channels = components.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

describe.each([':root', '.dark'])(
  '%s brand palette readability',
  (selector) => {
    const block = theme.slice(theme.indexOf(`${selector} {`)).split('}')[0]
    const colors = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/gi)].map((match) => [
        match[1],
        match[2],
      ])
    )

    it.each([
      ['foreground', 'background'],
      ['card-foreground', 'card'],
      ['popover-foreground', 'popover'],
      ['primary-foreground', 'primary'],
      ['secondary-foreground', 'secondary'],
      ['muted-foreground', 'muted'],
      ['muted-foreground', 'card'],
      ['sidebar-foreground', 'sidebar'],
    ])(
      'keeps %s readable on %s for normal-size text',
      (foreground, background) => {
        expect(colors[foreground]).toBeDefined()
        expect(colors[background]).toBeDefined()
        const values = [
          luminance(colors[foreground]),
          luminance(colors[background]),
        ]
        const contrast =
          (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
    )
  }
)
