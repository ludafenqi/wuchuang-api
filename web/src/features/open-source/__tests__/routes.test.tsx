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
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { defaultFooterConfig } from '@/features/footer/config'
import { HomeFooter } from '@/features/home/components/home-footer'
import { api } from '@/lib/api'
import { Route as AboutRoute } from '@/routes/about'
import { redirectToHomeNotice } from '@/routes/open-source'

describe('public about and open-source routes', () => {
  it.each([
    ['/about', 'Original About content'],
    ['/about', ''],
    ['/open-source', 'Original About content'],
    ['/open-source/', 'Original About content'],
  ])(
    'keeps %s accessible with About content "%s" and reads the home notice from configuration',
    async (path, aboutContent) => {
      vi.stubEnv(
        'VITE_SOURCE_REVISION',
        '0123456789abcdef0123456789abcdef01234567'
      )
      localStorage.clear()
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      vi.spyOn(api, 'get').mockImplementation(async (url) => ({
        data: {
          success: true,
          data:
            url === '/api/status'
              ? {
                  demo_site_enabled: false,
                  footer_config: JSON.stringify({
                    ...defaultFooterConfig(),
                    openSourceNotice: [
                      'Frontend design and development by New API contributors.',
                      '[New API](https://github.com/QuantumNous/new-api)',
                      '[Corresponding source code](https://github.com/ludafenqi/wuchuang-api/tree/0123456789abcdef0123456789abcdef01234567)',
                      '[AGPLv3 · LICENSE](https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/LICENSE)',
                      '[NOTICE](https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/NOTICE)',
                      '[THIRD-PARTY-LICENSES.md](https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/THIRD-PARTY-LICENSES.md)',
                    ].join('\n\n'),
                  }),
                }
              : aboutContent,
        },
      }))
      const root = createRootRoute({
        component: Outlet,
      })
      const routeTree = root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: '/',
          component: HomeFooter,
        }),
        createRoute({
          getParentRoute: () => root,
          path: '/about',
          component: AboutRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => root,
          path: '/open-source',
          beforeLoad: redirectToHomeNotice,
        }),
      ])
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [path] }),
      })
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      await router.load()
      render(
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      )
      if (path === '/about') {
        expect(
          await screen.findByText(aboutContent || 'No About Content Set')
        ).toBeVisible()
        expect(
          screen.queryByRole('link', { name: 'Open-source notice' })
        ).not.toBeInTheDocument()
        expect(
          document.querySelector(
            'a[href="https://github.com/QuantumNous/new-api"]'
          )
        ).not.toBeInTheDocument()
        expect(
          screen.queryByText(/New API Project Repository:/)
        ).not.toBeInTheDocument()
      } else {
        expect(router.state.location.pathname).toBe('/')
        expect(router.state.location.hash).toBe('open-source')
        const dialog = await screen.findByRole('dialog', {
          name: 'Open-source notice',
        })
        expect(
          within(dialog).getByRole('heading', {
            name: 'Open-source notice',
          })
        ).toBeVisible()
        expect(
          await within(dialog).findByText(
            'Frontend design and development by New API contributors.'
          )
        ).toBeVisible()
        expect(
          within(dialog).getByRole('link', { name: 'New API' })
        ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
        expect(
          within(dialog).getByRole('link', {
            name: 'Corresponding source code',
          })
        ).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/tree/0123456789abcdef0123456789abcdef01234567'
        )
        expect(
          within(dialog).getByRole('link', { name: 'AGPLv3 · LICENSE' })
        ).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/LICENSE'
        )
        expect(
          within(dialog).getByRole('link', { name: 'NOTICE' })
        ).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/NOTICE'
        )
        expect(
          within(dialog).getByRole('link', { name: 'THIRD-PARTY-LICENSES.md' })
        ).toBeVisible()
        await userEvent.setup().keyboard('{Escape}')
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        )
        expect(router.state.location.pathname).toBe('/')
        expect(router.state.location.hash).toBe('')
      }
      expect(
        screen.queryByRole('complementary', { name: 'Legal' })
      ).not.toBeInTheDocument()
      client.clear()
      localStorage.clear()
      vi.unstubAllEnvs()
    }
  )
})
