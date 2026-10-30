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
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  defaultFooterConfig,
  footerConfigSchema,
  parseFooterConfig,
} from '@/features/footer/config'
import { useStatus } from '@/hooks/use-status'

import { HomeOpenSourceNotice } from '../home-notice'

vi.mock('@/hooks/use-status', () => ({ useStatus: vi.fn() }))

describe('configured home open-source notice', () => {
  it.each([undefined, '', ' \n\t '])(
    'shows an explicit empty state without legacy attribution for %s',
    (openSourceNotice) => {
      vi.mocked(useStatus).mockReturnValue({
        status: {
          footer_config: JSON.stringify({
            ...defaultFooterConfig(),
            openSourceNotice,
          }),
        },
        loading: false,
        error: null,
      })
      const view = render(<HomeOpenSourceNotice />)
      expect(screen.getByText('No open-source notice configured')).toBeVisible()
      expect(view.container).not.toHaveTextContent(
        'New API Project Repository:'
      )
      expect(view.container.querySelector('a')).toBeNull()
    }
  )

  it('preserves configured multiline text and safe links through Markdown sanitization', () => {
    vi.mocked(useStatus).mockReturnValue({
      status: {
        footer_config: JSON.stringify({
          ...defaultFooterConfig(),
          openSourceNotice:
            '## Operator credits\nOriginal author credits\n[Source](/source)\n[License](https://example.com/license)',
        }),
      },
      loading: false,
      error: null,
    })
    render(<HomeOpenSourceNotice />)
    expect(
      screen.getByRole('heading', { name: 'Operator credits' })
    ).toBeVisible()
    expect(screen.getByText(/Original author credits/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      new URL('/source', window.location.origin).href
    )
    expect(screen.getByRole('link', { name: 'License' })).toHaveAttribute(
      'href',
      'https://example.com/license'
    )
    expect(screen.getByRole('link', { name: 'License' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
  })

  it('removes scripts, event handlers, embedded documents and unsafe link protocols', () => {
    const payload =
      '<script>window.__noticeXss=1</script><img src=x onerror="window.__noticeXss=2"><svg onload="window.__noticeXss=3"></svg><iframe srcdoc="<script>alert(1)</script>"></iframe>\n\n<a href="javascript:alert(1)">JavaScript</a> <a href="java&#x09;script:alert(1)">Obfuscated</a> <a href="data:text/html,test">Data</a> <a href="file:///etc/passwd">File</a> [Safe](https://example.com/source)'
    vi.mocked(useStatus).mockReturnValue({
      status: {
        footer_config: JSON.stringify({
          ...defaultFooterConfig(),
          openSourceNotice: payload,
        }),
      },
      loading: false,
      error: null,
    })
    const view = render(<HomeOpenSourceNotice />)
    expect(
      view.container.querySelector(
        'script, iframe, [onerror], [onload], [srcdoc]'
      )
    ).toBeNull()
    for (const label of ['JavaScript', 'Obfuscated', 'Data', 'File']) {
      expect(screen.getByText(label)).not.toHaveAttribute('href')
    }
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute(
      'href',
      'https://example.com/source'
    )
  })

  it('accepts existing configurations without the optional notice and bounds new drafts', () => {
    const { openSourceNotice: _notice, ...existing } = defaultFooterConfig()
    expect(parseFooterConfig(JSON.stringify(existing))).toEqual(existing)
    expect(
      footerConfigSchema.safeParse({
        ...existing,
        openSourceNotice: 'x'.repeat(12001),
      }).success
    ).toBe(false)
    expect(
      footerConfigSchema.safeParse({ ...existing, openSourceNotice: '' })
        .success
    ).toBe(true)
  })
})
