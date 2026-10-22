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
import { render, screen, within, act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { BrandFooter } from '../brand-footer'
import {
  defaultFooterConfig,
  isSafeFooterUrl,
  parseFooterConfig,
  visibleFooterLinks,
} from '../config'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: ComponentProps<'a'> & { to: string }) => (
    <a {...props} href={props.to} />
  ),
}))

describe('footer configuration', () => {
  it.each([
    undefined,
    '',
    '{broken',
    'null',
    '{"version":2}',
    { links: 'wrong' },
  ])('falls back safely for invalid configuration %s', (raw) => {
    expect(parseFooterConfig(raw)).toEqual(defaultFooterConfig())
  })
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.test',
    '/\\evil.test',
    '/%2fevil.test',
    '/%255cevil.test',
    'https://user:pass@example.com',
    'https://example.com\n/x',
  ])('rejects unsafe URL %s', (url) => {
    expect(isSafeFooterUrl(url, url.startsWith('https'))).toBe(false)
  })
  it('hides unavailable legal and documentation links, resolving configured documentation', () => {
    const config = defaultFooterConfig()
    expect(visibleFooterLinks(config, {}).map((link) => link.source)).toEqual([
      'models',
      'pricing',
      'about',
      'open-source',
    ])
    expect(
      visibleFooterLinks(config, {
        docsLink: 'https://docs.example.com',
        agreementEnabled: true,
        privacyEnabled: true,
      })
    ).toHaveLength(7)
    expect(
      visibleFooterLinks(config, { docsLink: 'javascript:alert(1)' })
    ).toHaveLength(4)
  })
})

describe('footer templates', () => {
  it.each(['brand', 'developer', 'minimal'] as const)(
    'renders the %s template with working links and fixed attribution',
    (layout) => {
      render(
        <BrandFooter
          config={{ ...defaultFooterConfig(), layout }}
          name='晤创AI'
          logo='/configured-logo.png'
        />
      )
      const footer = screen.getByRole('contentinfo')
      expect(footer).toHaveAttribute('data-layout', layout)
      expect(
        screen.getByText(
          `© ${new Date().getFullYear()} 晤创AI. All rights reserved.`
        )
      ).toBeVisible()
      expect(
        screen.getByText(
          'Frontend design and development by New API contributors.'
        )
      ).toBeVisible()
      expect(screen.getByRole('link', { name: 'New API' })).toHaveAttribute(
        'href',
        'https://github.com/QuantumNous/new-api'
      )
      expect(
        within(screen.getByRole('navigation')).getByRole('link', {
          name: 'Model Square',
        })
      ).toHaveAttribute('href', '/pricing')
      expect(screen.queryByRole('heading', { name: 'Product' }) !== null).toBe(
        layout === 'developer'
      )
      expect(footer.querySelector('img') !== null).toBe(layout !== 'minimal')
    }
  )
  it('hides the footer and restores it with defaults', () => {
    const view = render(
      <BrandFooter
        config={{ ...defaultFooterConfig(), enabled: false }}
        name='晤创AI'
      />
    )
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    view.rerender(<BrandFooter config={defaultFooterConfig()} name='晤创AI' />)
    expect(screen.getByRole('contentinfo')).toBeVisible()
  })
  it('honors custom years and rolls the automatic year over on a long-lived page', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T23:59:40'))
    const view = render(
      <BrandFooter config={defaultFooterConfig()} name='Brand' />
    )
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('© 2027 Brand. All rights reserved.')).toBeVisible()
    view.rerender(
      <BrandFooter
        config={{
          ...defaultFooterConfig(),
          autoYear: false,
          year: '2020-2026',
        }}
        name='Brand'
      />
    )
    expect(
      screen.getByText('© 2020-2026 Brand. All rights reserved.')
    ).toBeVisible()
    vi.useRealTimers()
  })
  it('preserves safe legacy HTML while removing executable markup and isolating styles', () => {
    const config = defaultFooterConfig()
    const html =
      '<style>body{display:none}</style><p>Legacy content</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">Unsafe</a><a href="https://example.com" target="_blank">Safe</a>'
    const view = render(
      <BrandFooter config={config} name='Brand' legacyHtml={html} />
    )
    const shadow = view.container.querySelector('.custom-footer')?.shadowRoot
    expect(shadow?.textContent).toContain('Legacy content')
    expect(
      shadow?.querySelector('script, [onerror], [href^="javascript:"]')
    ).toBeNull()
    expect(shadow?.querySelector('a[target="_blank"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
    expect(screen.queryByText('Brand')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New API' })).toBeVisible()
    view.rerender(
      <BrandFooter
        config={{ ...config, legacyMode: 'append' }}
        name='Brand'
        legacyHtml={html}
      />
    )
    expect(screen.getByText('Brand')).toBeVisible()
    view.rerender(
      <BrandFooter
        config={{ ...config, legacyMode: 'ignore' }}
        name='Brand'
        legacyHtml={html}
      />
    )
    expect(view.container.querySelector('.custom-footer')).toBeNull()
  })
})
