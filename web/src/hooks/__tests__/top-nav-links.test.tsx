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
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useTopNavLinks } from '../use-top-nav-links'

const clients: QueryClient[] = []

function renderNavigation(status: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], status)
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  return renderHook(() => useTopNavLinks(), { wrapper: Wrapper })
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  useAuthStore.getState().auth.reset()
})

it.each([undefined, ''])(
  'uses the existing public documentation fallback when docs_link is %s',
  (docsLink) => {
    const { result } = renderNavigation({ docs_link: docsLink })
    expect(result.current.find((link) => link.title === 'Docs')).toEqual({
      title: 'Docs',
      href: 'https://docs.newapi.pro',
      external: true,
    })
  }
)

it.each(['https://example.test/guide', '/custom-guide'])(
  'preserves the configured documentation target %s',
  (docsLink) => {
    const { result } = renderNavigation({ docs_link: docsLink })
    expect(result.current.find((link) => link.title === 'Docs')).toEqual({
      title: 'Docs',
      href: docsLink,
      external: true,
    })
  }
)

it('does not restore a documentation entry disabled in the existing navigation settings', () => {
  const { result } = renderNavigation({
    HeaderNavModules: JSON.stringify({ docs: false }),
  })
  expect(result.current.some((link) => link.title === 'Docs')).toBe(false)
})

it('preserves menu order and configured authentication requirements', () => {
  const { result } = renderNavigation({
    HeaderNavModules: JSON.stringify({
      pricing: { enabled: true, requireAuth: true },
      rankings: { enabled: true, requireAuth: true },
    }),
  })
  expect(result.current.map((link) => link.title)).toEqual([
    'Home',
    'Console',
    'Model Square',
    'Rankings',
    'Docs',
    'About',
  ])
  expect(
    result.current.filter((link) => link.requiresAuth).map((link) => link.title)
  ).toEqual(['Model Square', 'Rankings'])
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'preview', role: 1 })
  )
  expect(result.current.filter((link) => link.requiresAuth)).toEqual([])
})
