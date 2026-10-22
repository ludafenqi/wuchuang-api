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
    const payload = put.mock.calls[0][1] as { key: string; value: string }
    expect(payload.key).toBe('FooterConfig')
    expect(JSON.parse(payload.value).links).toEqual([
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
    expect(
      put.mock.calls.map((call) => (call[1] as { key: string }).key)
    ).toEqual(['FooterConfig'])
    expect(
      JSON.parse((put.mock.calls[0][1] as { value: string }).value).legacyMode
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
