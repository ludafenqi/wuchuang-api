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
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { Footer } from '@/components/layout/components/footer'
import { defaultFooterConfig } from '@/features/footer/config'
import { api } from '@/lib/api'
import { Route as RootRoute } from '@/routes/__root'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Home } from '..'

let client: QueryClient
let status: Record<string, unknown>
let content: string
let pricing: Record<string, unknown>
let originalNamespaceSeparator: typeof i18next.options.nsSeparator
beforeAll(async () => {
  originalNamespaceSeparator = i18next.options.nsSeparator
  // Match the application's literal-URL translation key configuration.
  await i18next.init({ ...i18next.options, nsSeparator: false })
})
afterAll(async () => {
  await i18next.init({
    ...i18next.options,
    nsSeparator: originalNamespaceSeparator,
  })
})
beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  status = { system_name: 'WuCora', demo_site_enabled: false }
  content = ''
  pricing = { success: true, data: [], vendors: [] }
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/pricing') return { data: pricing }
    return {
      data: { success: true, data: url === '/api/status' ? status : content },
    }
  })
})
afterEach(() => {
  client.clear()
  localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

const paths = [
  '/pricing',
  '/sign-in',
  '/sign-up',
  '/otp',
  '/dashboard/overview',
  '/wallet',
  '/subscriptions',
  '/profile',
  '/keys',
  '/usage-logs',
  '/usage-logs/audit',
  '/system-settings',
  '/about',
]

async function renderHome() {
  const root = createRootRoute({ component: RootRoute.options.component })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: Home }),
      ...paths.map((path) =>
        createRoute({
          getParentRoute: () => root,
          path,
          component: () => (
            <>
              <h1>{path}</h1>
              <Footer />
            </>
          ),
        })
      ),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, view }
}

describe('public home layout', () => {
  it('keeps the home footer free of the old fixed repository link and attribution block', async () => {
    await renderHome()
    await screen.findByRole('link', { name: 'Open-source notice' })
    expect(
      screen.queryByRole('link', { name: 'New API' })
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('a[href="https://github.com/QuantumNous/new-api"]')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/New API Project Repository:/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Based on One API/)).not.toBeInTheDocument()
    expect(screen.queryByText(/NewAPI ©/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Open-source notice' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'WuCora' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('shows the configured notice only after opening the home dialog, even with its business footer disabled', async () => {
    status.footer_config = JSON.stringify({
      ...defaultFooterConfig(),
      enabled: false,
      openSourceNotice:
        '## Operator notice\nCredits and [source](https://example.com/source).',
    })
    const { router } = await renderHome()
    expect(screen.queryByText('Operator notice')).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    await act(() => router.navigate({ hash: 'open-source' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Open-source notice',
    })
    expect(
      within(dialog).getByRole('heading', { name: 'Operator notice' })
    ).toBeVisible()
    expect(
      within(dialog).getByRole('link', { name: 'source' })
    ).toHaveAttribute('href', 'https://example.com/source')
    await act(() => {
      client.setQueryData(['status'], {
        ...status,
        footer_config: JSON.stringify({
          ...defaultFooterConfig(),
          enabled: false,
          openSourceNotice: 'Updated operator notice',
        }),
      })
    })
    expect(
      await within(dialog).findByText('Updated operator notice')
    ).toBeVisible()
    expect(
      within(dialog).queryByText('Operator notice')
    ).not.toBeInTheDocument()
    await userEvent.setup().keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(router.state.location.hash).toBe('')
  })
  it('shows one home notice and no page notice after navigating to any other layout', async () => {
    const { router, view } = await renderHome()
    expect(
      await screen.findByRole('link', { name: 'Open-source notice' })
    ).toHaveAttribute('href', '/open-source')
    expect(
      screen.getAllByRole('link', { name: 'Open-source notice' })
    ).toHaveLength(1)
    for (const path of paths) {
      await act(() => router.navigate({ to: path }))
      expect(await screen.findByRole('heading', { name: path })).toBeVisible()
      expect(
        screen.queryByRole('link', { name: 'Open-source notice' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(
          'Frontend design and development by New API contributors.'
        )
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByRole('contentinfo')).getByRole('link', {
          name: 'Model Square',
        })
      ).toHaveAttribute('href', '/pricing')
    }
    view.unmount()
  })

  it('keeps demonstration help navigation while using the configurable home notice instead of its old repository attribution', async () => {
    status.demo_site_enabled = true
    await renderHome()
    await waitFor(() =>
      expect(
        document.querySelector('a[href="https://docs.newapi.pro/api/"]')
      ).toBeInTheDocument()
    )
    expect(
      document.querySelector('a[href="https://github.com/QuantumNous/new-api"]')
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Open-source notice' })
    ).toHaveLength(1)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('WuCora')
  })

  it('shows an empty catalog without invented models or service statistics', async () => {
    await renderHome()
    expect(await screen.findByText('No models available yet')).toBeVisible()
    expect(
      screen.queryByRole('list', { name: 'Model Square' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('50+')).not.toBeInTheDocument()
  })

  it('links live catalog entries to their real model search', async () => {
    pricing = {
      success: true,
      vendors: [{ id: 1, name: 'Catalog vendor' }],
      data: [{ model_name: 'catalog/model-with-a-long-name', vendor_id: 1 }],
    }
    await renderHome()
    const link = await screen.findByRole('link', {
      name: /catalog\/model-with-a-long-name/,
    })
    expect(link).toHaveAttribute(
      'href',
      '/pricing?search=catalog%2Fmodel-with-a-long-name'
    )
    expect(within(link).getByText('Catalog vendor')).toBeVisible()
  })

  it('does not request or expose the catalog when access requires sign-in', async () => {
    status.HeaderNavModules = JSON.stringify({
      pricing: { enabled: true, requireAuth: true },
    })
    await renderHome()
    expect(
      await screen.findByText(
        'Visit the model catalog to check access and available models.'
      )
    ).toBeVisible()
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/pricing')
    ).toBe(false)
  })

  it('shows a retry action when the catalog request fails and recovers on retry', async () => {
    const user = userEvent.setup()
    pricing = { success: false, message: 'Catalog unavailable' }
    await renderHome()
    expect(
      await screen.findByText('Failed to load model pricing')
    ).toBeVisible()
    pricing = { success: true, data: [], vendors: [] }
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No models available yet')).toBeVisible()
  })

  it('keeps administrator home content and the home notice together', async () => {
    content = '# Administrator home'
    await renderHome()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Administrator home' })
      ).toBeVisible()
    )
    expect(
      screen.queryByRole('heading', { name: 'Connect intelligence.' })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Open-source notice' })
    ).toHaveLength(1)
  })

  it('hides registration actions when registration is disabled', async () => {
    status.register_enabled = false
    await renderHome()
    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Get Started' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create an account' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Explore models' })
    ).toHaveAttribute('href', '/pricing')
  })
})
