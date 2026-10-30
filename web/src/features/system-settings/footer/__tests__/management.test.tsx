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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { defaultFooterConfig } from '@/features/footer/config'
import { api } from '@/lib/api'

import type { SiteSettings } from '../../types'
import { FooterManagement } from '../section'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: ComponentProps<'a'> & { to: string }) => (
    <a {...props} href={props.to} />
  ),
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const settings: SiteSettings = {
  Notice: '',
  SystemName: '晤创AI',
  Logo: '/logo.png',
  Footer: '',
  FooterConfig: '',
  About: '',
  HomePageContent: '',
  ServerAddress: '',
  TaskPublicAddress: '',
  'general_setting.docs_link': '',
  'legal.user_agreement': '',
  'legal.privacy_policy': '',
  HeaderNavModules: '',
  SidebarModulesAdmin: '',
}

function renderManagement(overrides: Partial<SiteSettings> = {}) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <FooterManagement settings={{ ...settings, ...overrides }} />
    </QueryClientProvider>
  )
}

describe('visual footer management', () => {
  it('saves a multiline home notice with editable links and restores it when the settings reopen', async () => {
    const user = userEvent.setup()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const view = renderManagement()
    const content = 'Operator credits\n\n[Source](https://example.com/source)'
    await user.click(screen.getByLabelText('Home open-source notice'))
    await user.paste(content)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledExactlyOnceWith('/api/option/footer', {
        SystemName: settings.SystemName,
        FooterConfig: JSON.stringify({
          ...defaultFooterConfig(),
          openSourceNotice: content,
        }),
      })
    )
    const stored = (put.mock.calls[0][1] as { FooterConfig: string })
      .FooterConfig
    view.unmount()
    renderManagement({ FooterConfig: stored })
    expect(screen.getByLabelText('Home open-source notice')).toHaveValue(
      content
    )
  })

  it('keeps a notice draft after save failure and preserves it when resetting visual defaults', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Storage unavailable' },
    })
    renderManagement({
      FooterConfig: JSON.stringify({
        ...defaultFooterConfig(),
        openSourceNotice: 'Existing credits',
      }),
    })
    await user.clear(screen.getByLabelText('Home open-source notice'))
    await user.type(
      screen.getByLabelText('Home open-source notice'),
      'New credits'
    )
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(screen.getByLabelText('Home open-source notice')).toHaveValue(
      'New credits'
    )
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByLabelText('Home open-source notice')).toHaveValue(
      'New credits'
    )
  })

  it('submits the name and footer as one operation and keeps both draft fields after failure', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Storage unavailable' },
    })
    renderManagement()
    await user.clear(screen.getByLabelText('Brand name'))
    await user.type(screen.getByLabelText('Brand name'), 'Updated brand')
    await user.clear(screen.getByLabelText('Brand description'))
    await user.type(
      screen.getByLabelText('Brand description'),
      'Updated description'
    )
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/option/footer', {
      SystemName: 'Updated brand',
      FooterConfig: JSON.stringify({
        ...defaultFooterConfig(),
        description: 'Updated description',
      }),
    })
    expect(screen.getByLabelText('Brand name')).toHaveValue('Updated brand')
    expect(screen.getByLabelText('Brand description')).toHaveValue(
      'Updated description'
    )
  })
  it('previews changes without saving and supports mobile and dark previews', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put')
    renderManagement()
    const description = screen.getByLabelText('Brand description')
    await user.clear(description)
    await user.type(description, 'A new description')
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(within(preview).getByText('A new description')).toBeVisible()
    await user.click(screen.getByRole('combobox', { name: 'Footer layout' }))
    await user.click(screen.getByRole('option', { name: 'Developer platform' }))
    expect(
      within(preview).getByRole('heading', { name: 'Product' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Mobile' }))
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(put).not.toHaveBeenCalled()
  })
  it('adds, edits, reorders and deletes links, then saves a structured option', async () => {
    const user = userEvent.setup()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    renderManagement({
      FooterConfig: JSON.stringify({ ...defaultFooterConfig(), links: [] }),
    })
    await user.click(screen.getByRole('button', { name: 'Add link' }))
    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Support center')
    await user.type(screen.getByLabelText('URL'), '/about')
    await user.click(screen.getByRole('button', { name: 'Add link' }))
    await user.type(screen.getAllByLabelText('URL')[1], '/pricing')
    await user.click(screen.getAllByRole('button', { name: 'Move up' })[1])
    expect(screen.getAllByLabelText('URL')[0]).toHaveValue('/pricing')
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    const payload = put.mock.calls[0][1] as {
      SystemName: string
      FooterConfig: string
    }
    expect(payload.SystemName).toBe('晤创AI')
    expect(JSON.parse(payload.FooterConfig).links).toEqual([
      expect.objectContaining({ label: 'Support center', url: '/about' }),
    ])
  })
  it('hides the footer and restores defaults without deleting legacy HTML', async () => {
    const user = userEvent.setup()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    renderManagement({ Footer: '<p>Custom footer</p>' })
    await user.click(screen.getByRole('switch', { name: 'Show footer' }))
    expect(
      screen.getByText(
        'The footer is hidden. The open-source notice remains accessible.'
      )
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('switch', { name: 'Show footer' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/api/option/footer')
    expect(
      JSON.parse(
        (put.mock.calls[0][1] as { FooterConfig: string }).FooterConfig
      ).legacyMode
    ).toBe('ignore')
  })
  it('rejects unsafe URLs and retains the draft when saving fails', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Storage unavailable' },
    })
    renderManagement({
      FooterConfig: JSON.stringify({ ...defaultFooterConfig(), links: [] }),
    })
    await user.click(screen.getByRole('button', { name: 'Add link' }))
    await user.type(screen.getByLabelText('URL'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(put).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), '/about')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(screen.getByLabelText('URL')).toHaveValue('/about')
  })
})
