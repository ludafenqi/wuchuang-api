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
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as AboutRoute } from '@/routes/about'
import { Route as NoticeRoute } from '@/routes/open-source'

import { FooterNoticeProvider, OpenSourceAccess } from '../access'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: ReactNode }) => (
    <main>{props.children}</main>
  ),
}))

describe('public about and open-source routes', () => {
  it.each(['/about', '/open-source'])(
    'keeps %s accessible independently of administrator content',
    async (path) => {
      vi.stubEnv(
        'VITE_SOURCE_REVISION',
        '0123456789abcdef0123456789abcdef01234567'
      )
      vi.spyOn(api, 'get').mockResolvedValue({
        data: { success: true, data: 'Original About content' },
      })
      const root = createRootRoute({
        component: () => (
          <FooterNoticeProvider>
            <Outlet />
            <OpenSourceAccess />
          </FooterNoticeProvider>
        ),
      })
      const routeTree = root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: '/about',
          component: AboutRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => root,
          path: '/open-source',
          component: NoticeRoute.options.component,
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
        expect(await screen.findByText('Original About content')).toBeVisible()
      } else {
        expect(
          await screen.findByRole('heading', {
            name: 'Open-source notice',
            level: 1,
          })
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
          screen.getByRole('link', { name: 'Corresponding source code' })
        ).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/tree/0123456789abcdef0123456789abcdef01234567'
        )
        expect(
          screen.getByRole('link', { name: 'AGPLv3 · LICENSE' })
        ).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/LICENSE'
        )
        expect(screen.getByRole('link', { name: 'NOTICE' })).toHaveAttribute(
          'href',
          'https://github.com/ludafenqi/wuchuang-api/blob/0123456789abcdef0123456789abcdef01234567/NOTICE'
        )
        expect(
          screen.getByRole('link', { name: 'THIRD-PARTY-LICENSES.md' })
        ).toBeVisible()
      }
      if (path === '/about') {
        expect(
          screen.getByRole('complementary', { name: 'Legal' })
        ).toBeVisible()
      } else {
        expect(
          screen.queryByRole('complementary', { name: 'Legal' })
        ).not.toBeInTheDocument()
      }
      client.clear()
      vi.unstubAllEnvs()
    }
  )
})
