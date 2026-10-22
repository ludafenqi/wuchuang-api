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
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { statusQueryOptions } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useUpdateOption } from '../../hooks/use-update-option'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('branding option cache refresh', () => {
  it.each([
    'SystemName',
    'Logo',
    'Footer',
    'FooterConfig',
    'About',
    'footer batch',
  ])('refreshes inactive status after saving %s', async (key) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { system_name: 'Before', logo: '/old.png', footer_html: 'old' },
      },
    })
    await client.fetchQuery(statusQueryOptions)
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: { system_name: 'After', logo: '/new.png', footer_html: 'new' },
      },
    })
    vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
    client.setQueryData(['about-content'], { success: true, data: 'old' })
    const wrapper = (props: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
    const hook = renderHook(() => useUpdateOption(), { wrapper })
    await act(() =>
      hook.result.current.mutateAsync(
        key === 'footer batch'
          ? { SystemName: 'After', FooterConfig: 'value' }
          : { key, value: 'value' }
      )
    )
    await waitFor(() =>
      expect(useSystemConfigStore.getState().config.systemName).toBe('After')
    )
    expect(useSystemConfigStore.getState().config.logo).toBe('/new.png')
    expect(useSystemConfigStore.getState().config.footerHtml).toBe('new')
    if (key === 'footer batch') {
      expect(api.put).toHaveBeenCalledWith('/api/option/footer', {
        SystemName: 'After',
        FooterConfig: 'value',
      })
    }
    if (key === 'About') {
      expect(client.getQueryState(['about-content'])?.isInvalidated).toBe(true)
    }
    hook.unmount()
    client.clear()
  })
})
