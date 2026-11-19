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
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { HeaderLogo } from '@/components/layout/components/header-logo'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { api } from '@/lib/api'
import { applySystemBrandingToDom } from '@/lib/dom-utils'
import {
  getModuleAccessForGuard,
  type HeaderNavModule,
} from '@/lib/nav-modules'
import {
  STATUS_QUERY_KEY,
  ensureStatus,
  mapStatusDataToConfig,
  statusQueryOptions,
} from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * Guards the deduplication contract of the shared `['status']` query: several
 * independent consumers asking for status must cost one `/api/status` request.
 */

type ApiMethod = (url: string) => Promise<{ data: unknown }>
type MockableApi = { get: ApiMethod }

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get

let statusRequests: string[] = []
const queryClients: QueryClient[] = []

/** Count `/api/status` calls at the network boundary and serve `system_name`. */
function stubStatusEndpoint(systemName: string): void {
  apiClient.get = async (url) => {
    if (url !== '/api/status') throw new Error(`Unexpected GET ${url}`)
    statusRequests.push(url)
    return { data: { success: true, data: { system_name: systemName } } }
  }
}

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  return queryClient
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  statusRequests = []
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document
    .querySelectorAll('link[rel~="icon"]')
    .forEach((link) => link.remove())
  queryClients.splice(0).forEach((client) => client.clear())
  apiClient.get = originalGet
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

describe('site branding configuration', () => {
  test('updates the browser title and favicon when configured branding changes', () => {
    applySystemBrandingToDom({ systemName: 'WuCora', logo: '/wucora-logo.png' })
    expect(document.title).toBe('WuCora')
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/wucora-favicon.ico'
    )
    applySystemBrandingToDom({ systemName: 'Custom site', logo: '/custom.png' })
    expect(document.title).toBe('Custom site')
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/custom.png'
    )
  })

  test.each([
    {},
    { system_name: '', logo: '' },
    { system_name: '  ', logo: '  ' },
  ])(
    'uses WuCora when the status response omits configured branding',
    (status) => {
      expect(mapStatusDataToConfig(status)).toMatchObject({
        systemName: 'WuCora',
        logo: '/wucora-logo-128.webp',
      })
    }
  )

  test('initializes the site brand before status is fetched', () => {
    expect(useSystemConfigStore.getState().config).toMatchObject({
      systemName: 'WuCora',
      logo: '/wucora-logo-128.webp',
    })
  })

  test.each(['Custom site', 'New API'])(
    'keeps an explicitly configured %s name and logo',
    (name) => {
      expect(
        mapStatusDataToConfig({
          system_name: name,
          logo: 'https://example.test/custom-logo.png',
          footer_html: '<p>Custom footer</p>',
        })
      ).toMatchObject({
        systemName: name,
        logo: 'https://example.test/custom-logo.png',
        footerHtml: '<p>Custom footer</p>',
      })
    }
  )
  test.each([
    '/wucora-logo.png',
    '/wucora-logo.png?revision=old',
    '/wucora-logo-128.webp',
    '/wucora-logo-192.webp',
    new URL('/wucora-logo.png', window.location.href).href,
    '',
  ])(
    'keeps the small default favicon for the bundled logo alias %s',
    (logo) => {
      applySystemBrandingToDom({ systemName: 'WuCora', logo })
      const icon = document.querySelector('link[rel="icon"]')
      expect(icon).toHaveAttribute('href', '/wucora-favicon.ico')
      applySystemBrandingToDom({
        systemName: 'WuCora',
        logo: '/wucora-logo.png',
      })
      expect(document.querySelector('link[rel="icon"]')).toBe(icon)
    }
  )

  test('preserves an external custom logo even when its basename matches the old default', () => {
    const logo = 'https://custom.example/wucora-logo.png?v=2'
    applySystemBrandingToDom({ systemName: 'Custom', logo })
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      logo
    )
    applySystemBrandingToDom({ systemName: 'Custom', logo: '' })
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/wucora-favicon.ico'
    )
    expect(document.title).toBe('Custom')
  })

  test('falls back to the small favicon after a custom icon fails without changing the configured logo', () => {
    useSystemConfigStore.getState().setConfig({ logo: '/missing-custom.png' })
    applySystemBrandingToDom(useSystemConfigStore.getState().config)
    const icon = document.querySelector('link[rel="icon"]')
    if (!icon) throw new Error('Configured favicon missing')
    fireEvent.error(icon)
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/wucora-favicon.ico'
    )
    expect(useSystemConfigStore.getState().config.logo).toBe(
      '/missing-custom.png'
    )
  })

  test('loads the compact image from persisted legacy branding, accepts a network custom logo, and falls back after clearing it', async () => {
    const images: HTMLImageElement[] = []
    vi.stubGlobal(
      'Image',
      vi.fn(function () {
        const image = document.createElement('img')
        images.push(image)
        return image
      })
    )
    localStorage.setItem(
      'system-config-storage',
      JSON.stringify({
        state: {
          config: {
            ...useSystemConfigStore.getInitialState().config,
            logo: '/wucora-logo.png',
          },
          loadedLogoUrl: '/wucora-logo.png',
        },
        version: 0,
      })
    )
    await useSystemConfigStore.persist.rehydrate()
    const client = createQueryClient()
    const hook = renderHook(() => useSystemConfig(), {
      wrapper: wrapper(client),
    })
    expect(hook.result.current.logo).toBe('/wucora-logo-128.webp')
    expect(images.at(-1)).toHaveAttribute('src', '/wucora-logo-128.webp')
    const defaultImage = images.at(-1)
    if (!defaultImage) throw new Error('Default logo preload missing')
    act(() => fireEvent.load(defaultImage))
    expect(hook.result.current.logoLoaded).toBe(true)

    apiClient.get = async () => ({
      data: {
        success: true,
        data: { system_name: 'Custom', logo: '/custom.png' },
      },
    })
    await act(async () => {
      await ensureStatus(client)
    })
    expect(hook.result.current.logo).toBe('/custom.png')
    expect(images.at(-1)).toHaveAttribute('src', '/custom.png')
    applySystemBrandingToDom(useSystemConfigStore.getState().config)
    const customImage = images.at(-1)
    if (!customImage) throw new Error('Custom logo preload missing')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => fireEvent.error(customImage))
    expect(hook.result.current.logoLoaded).toBe(true)
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/wucora-favicon.ico'
    )

    apiClient.get = async () => ({
      data: { success: true, data: { system_name: 'Custom', logo: '' } },
    })
    await act(async () => {
      await client.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      await client.fetchQuery(statusQueryOptions)
    })
    expect(hook.result.current.logo).toBe('/wucora-logo-128.webp')
    expect(images.at(-1)).toHaveAttribute('src', '/wucora-logo-128.webp')
  })

  test('keeps a failed custom brand image in its reserved box and leaves the admin setting intact', () => {
    useSystemConfigStore.getState().setConfig({ logo: '/missing-custom.png' })
    render(
      <HeaderLogo
        src='/missing-custom.png'
        alt='Configured brand'
        loading={false}
        logoLoaded
      />
    )
    const logo = screen.getByRole('img', { name: 'Configured brand' })
    expect(logo).toHaveAttribute('src', '/missing-custom.png')
    fireEvent.error(logo)
    expect(logo).toHaveAttribute('src', '/wucora-logo-128.webp')
    fireEvent.error(logo)
    expect(logo).toHaveAttribute('src', '/wucora-logo-128.webp')
    expect(useSystemConfigStore.getState().config.logo).toBe(
      '/missing-custom.png'
    )
  })
})

describe('shared status query deduplication', () => {
  test.each(['cold', 'stale'] as const)(
    'deduplicates %s cache requests across guards and hook consumers',
    async (cacheState) => {
      const queryClient = createQueryClient()
      if (cacheState === 'stale') {
        queryClient.setQueryData(
          STATUS_QUERY_KEY,
          {
            system_name: 'old',
            HeaderNavModules: { pricing: false, rankings: false },
          },
          { updatedAt: Date.now() - 600_000 }
        )
      }
      const status = {
        system_name: 'shared',
        HeaderNavModules: {
          pricing: { enabled: true, requireAuth: true },
          rankings: { enabled: true, requireAuth: false },
        },
      }
      let resolveStatus!: (value: { data: unknown }) => void
      const response = new Promise<{ data: unknown }>((resolve) => {
        resolveStatus = resolve
      })
      apiClient.get = (url) => {
        statusRequests.push(url)
        return response
      }
      let guardsResolved = false
      const guards = Promise.all([
        getModuleAccessForGuard(queryClient, 'pricing'),
        getModuleAccessForGuard(queryClient, 'rankings'),
      ]).then((result) => {
        guardsResolved = true
        return result
      })
      const hook = renderHook(() => useStatus(), {
        wrapper: wrapper(queryClient),
      })
      await waitFor(() => expect(statusRequests).toEqual(['/api/status']))
      expect(guardsResolved).toBe(false)
      resolveStatus({ data: { success: true, data: status } })
      expect(await guards).toEqual([
        { enabled: true, requireAuth: true },
        { enabled: true, requireAuth: false },
      ])
      await waitFor(() =>
        expect(hook.result.current.status?.system_name).toBe('shared')
      )
      expect(statusRequests).toHaveLength(1)
    }
  )

  test('resolves a later consumer from the warm cache without a second request', async () => {
    stubStatusEndpoint('warm')
    const queryClient = createQueryClient()

    await ensureStatus(queryClient)
    const second = await ensureStatus(queryClient)

    expect(second?.system_name).toBe('warm')
    expect(statusRequests).toHaveLength(1)
  })

  test('returns a stale entry immediately and refreshes it in the background', async () => {
    stubStatusEndpoint('refreshed')
    const queryClient = createQueryClient()
    const staleTime = statusQueryOptions.staleTime as number
    queryClient.setQueryData(
      STATUS_QUERY_KEY,
      { system_name: 'stale' },
      {
        updatedAt: Date.now() - staleTime - 1,
      }
    )

    const resolved = await ensureStatus(queryClient)

    expect(resolved?.system_name).toBe('stale')
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Record<string, unknown>>(STATUS_QUERY_KEY)
          ?.system_name
      ).toBe('refreshed')
    })
    expect(statusRequests).toHaveLength(1)
  })
})

describe('module guard status freshness', () => {
  test.each([
    {
      module: 'pricing',
      before: { enabled: false, requireAuth: false },
      after: { enabled: true, requireAuth: false },
    },
    {
      module: 'rankings',
      before: { enabled: true, requireAuth: false },
      after: { enabled: false, requireAuth: false },
    },
    {
      module: 'pricing',
      before: { enabled: true, requireAuth: false },
      after: { enabled: true, requireAuth: true },
    },
    {
      module: 'rankings',
      before: { enabled: true, requireAuth: true },
      after: { enabled: true, requireAuth: false },
    },
  ])('uses refreshed $module access: $before -> $after', async (scenario) => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      STATUS_QUERY_KEY,
      { HeaderNavModules: { [scenario.module]: scenario.before } },
      { updatedAt: Date.now() - 600_000 }
    )
    apiClient.get = async () => ({
      data: {
        success: true,
        data: { HeaderNavModules: { [scenario.module]: scenario.after } },
      },
    })
    expect(
      await getModuleAccessForGuard(
        queryClient,
        scenario.module as HeaderNavModule
      )
    ).toEqual(scenario.after)
  })

  test('reuses fresh access but refreshes explicitly invalidated access', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(STATUS_QUERY_KEY, {
      HeaderNavModules: { pricing: false },
    })
    stubStatusEndpoint('updated')
    expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
      enabled: false,
      requireAuth: false,
    })
    expect(statusRequests).toHaveLength(0)
    await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
      enabled: true,
      requireAuth: false,
    })
    expect(statusRequests).toHaveLength(1)
  })

  test.each(['cold', 'stale'] as const)(
    'fails closed when a %s cache request fails',
    async (cacheState) => {
      const queryClient = createQueryClient()
      if (cacheState === 'stale') {
        queryClient.setQueryData(
          STATUS_QUERY_KEY,
          { HeaderNavModules: { pricing: true } },
          { updatedAt: Date.now() - 600_000 }
        )
      }
      apiClient.get = async () => {
        throw new Error('Status unavailable')
      }
      expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
        enabled: false,
        requireAuth: true,
      })
    }
  )
})
