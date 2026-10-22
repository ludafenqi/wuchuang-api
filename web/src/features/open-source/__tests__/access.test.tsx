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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Footer } from '@/components/layout/components/footer'
import { defaultFooterConfig } from '@/features/footer/config'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { FooterNoticeProvider, OpenSourceAccess } from '../access'

describe('supplementary open-source access', () => {
  it('uses the normal footer, restores access when hidden, and cleans up on navigation', async () => {
    const original = useSystemConfigStore.getState().config
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { system_name: 'Brand', demo_site_enabled: false },
      },
    })
    useSystemConfigStore.getState().setConfig({
      systemName: 'Brand',
      demoSiteEnabled: false,
      footerHtml: '',
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    await client.fetchQuery({
      queryKey: ['status'],
      queryFn: async () => ({
        footer_config: JSON.stringify(defaultFooterConfig()),
      }),
    })
    const root = createRootRoute({
      component: () => (
        <FooterNoticeProvider>
          <Outlet />
          <OpenSourceAccess />
        </FooterNoticeProvider>
      ),
    })
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: '/',
          component: Footer,
        }),
        createRoute({
          getParentRoute: () => root,
          path: '/about',
          component: () => <main>About content</main>,
        }),
        createRoute({
          getParentRoute: () => root,
          path: '/open-source',
          component: () => <main>Required open-source notice</main>,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    try {
      await waitFor(() =>
        expect(
          screen.queryByRole('complementary', { name: 'Legal' })
        ).not.toBeInTheDocument()
      )
      expect(
        within(screen.getByRole('contentinfo')).getAllByRole('link', {
          name: 'Open-source notice',
        }).length
      ).toBeGreaterThan(0)
      await act(async () => {
        client.setQueryData(['status'], {
          footer_config: JSON.stringify({
            ...defaultFooterConfig(),
            enabled: false,
          }),
        })
      })
      const legal = await screen.findByRole('complementary', { name: 'Legal' })
      expect(
        within(legal).getByRole('link', { name: 'Open-source notice' })
      ).toHaveAttribute('href', '/open-source')
      expect(getComputedStyle(legal).position).not.toBe('fixed')
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
      await act(() => router.navigate({ to: '/about' }))
      expect(
        await screen.findByRole('complementary', { name: 'Legal' })
      ).toBeVisible()
      await act(() => router.navigate({ to: '/open-source' }))
      expect(
        await screen.findByText('Required open-source notice')
      ).toBeVisible()
      expect(
        screen.queryByRole('complementary', { name: 'Legal' })
      ).not.toBeInTheDocument()
    } finally {
      view.unmount()
      client.clear()
      useSystemConfigStore.getState().setConfig(original)
    }
  })
})
