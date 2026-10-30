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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignUp } from '..'
import { AuthLayout } from '../../auth-layout'

let client: QueryClient
beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { register_enabled: true } },
  })
})
afterEach(() => {
  client.clear()
  localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  vi.restoreAllMocks()
})

async function renderAuthPage(component: () => React.ReactNode) {
  const language = createInstance()
  await language.init({
    lng: 'zh',
    fallbackLng: 'zh',
    resources: { zh },
    nsSeparator: false,
  })
  const router = createRouter({
    routeTree: createRootRoute({ component }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('registration brand headline', () => {
  it('renders the requested complete headline without explicit breaks and keeps the existing subtitle and form', async () => {
    await renderAuthPage(SignUp)
    const title = await screen.findByRole('heading', {
      name: '万千模型任你使用',
    })
    expect(title.textContent).toBe('万千模型任你使用')
    expect(title.querySelector('br')).toBeNull()
    expect(title.textContent).not.toMatch(/[\r\n]/)
    expect(
      screen.queryByRole('heading', { name: /一个网关/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        zh.translation['Build, connect, and scale your AI applications.']
      )
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: zh.translation['Create an account'] })
    ).toBeVisible()
    expect(screen.getByLabelText(zh.translation.Username)).toBeVisible()
  })
  it('keeps the original shared headline for authentication pages that do not supply a page-specific title', async () => {
    await renderAuthPage(() => (
      <AuthLayout>
        <p>Existing authentication content</p>
      </AuthLayout>
    ))
    const title = await screen.findByRole('heading', { name: /一个网关/ })
    expect(title.textContent).toBe('一个网关\n万千模型')
    expect(screen.queryByText('万千模型任你使用')).not.toBeInTheDocument()
    expect(screen.getByText('Existing authentication content')).toBeVisible()
  })
})
