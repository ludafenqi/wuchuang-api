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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignIn } from '..'

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

async function renderSignIn() {
  const language = createInstance()
  await language.init({
    lng: 'zh',
    fallbackLng: 'zh',
    resources: { zh, en },
    nsSeparator: false,
  })
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({
    getParentRoute: () => root,
    id: '(auth)',
    component: Outlet,
  })
  const signIn = createRoute({
    getParentRoute: () => auth,
    path: 'sign-in',
    component: SignIn,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([signIn])]),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  })
  await router.load()
  const view = render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { language, ...view }
}

describe('login brand headline', () => {
  it('uses the same complete headline as registration and preserves the subtitle and login form', async () => {
    await renderSignIn()
    const title = await screen.findByRole('heading', {
      name: '万千模型任你使用',
    })
    expect(title.textContent).toBe('万千模型任你使用')
    expect(title.querySelector('br')).toBeNull()
    expect(
      screen.queryByRole('heading', { name: /一个网关/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        zh.translation['Build, connect, and scale your AI applications.']
      )
    ).toBeVisible()
    expect(
      screen.getByText('OpenAI · Claude · Gemini · DeepSeek')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: zh.translation['Sign in'] })
    ).toBeVisible()
    expect(
      screen.getByLabelText(zh.translation['Username or Email'])
    ).toBeVisible()
    expect(screen.getByLabelText(zh.translation.Password)).toBeVisible()
  })

  it('updates the shared brand headline when the interface language changes', async () => {
    const { language } = await renderSignIn()
    await act(() => language.changeLanguage('en'))
    const title = await screen.findByRole('heading', {
      name: en.translation['Models at your fingertips'],
    })
    expect(title.textContent).toBe(en.translation['Models at your fingertips'])
    expect(title.querySelector('br')).toBeNull()
    expect(
      screen.queryByRole('heading', {
        name: en.translation['One gateway. Every model.'],
      })
    ).not.toBeInTheDocument()
  })
})
