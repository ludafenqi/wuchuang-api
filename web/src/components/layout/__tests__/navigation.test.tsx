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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { NavGroup } from '../components/nav-group'
import { PublicHeader } from '../components/public-header'
import { SectionPageLayout } from '../components/section-page-layout'

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/status' ? {} : '' },
  }))
})
afterEach(() => {
  client.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

async function renderRoute(component: () => React.ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('workspace navigation', () => {
  it('keeps the current destination and nested links accessible after collapsing the sidebar', async () => {
    const user = userEvent.setup()
    await renderRoute(() => (
      <SidebarProvider>
        <Sidebar>
          <NavGroup
            title='Workspace'
            items={[
              { title: 'Overview', url: '/' },
              {
                title: 'Manage',
                items: [{ title: 'Models', url: '/pricing' }],
              },
            ]}
          />
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    ))
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Models' })
    ).toHaveAttribute('href', '/pricing')
  })

  it('opens the mobile navigation with the keyboard, closes on Escape and restores focus', async () => {
    const user = userEvent.setup()
    await renderRoute(() => (
      <PublicHeader
        variant='landing'
        navLinks={[{ title: 'Models', href: '/pricing' }]}
        showNotifications={false}
        showAuthButtons={false}
        showLanguageSwitcher={false}
        showThemeSwitch={false}
      />
    ))
    const toggle = screen.getByRole('button', {
      name: 'Toggle navigation menu',
    })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(
      within(drawer).getByRole('link', { name: 'Model Square' })
    ).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    )
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('keeps long page titles, descriptions and actions available in fixed-content pages', async () => {
    await renderRoute(() => (
      <SectionPageLayout fixedContent stackActionsOnMobile>
        <SectionPageLayout.Title>
          A long workspace title with a model version suffix
        </SectionPageLayout.Title>
        <SectionPageLayout.Description>
          Page context
        </SectionPageLayout.Description>
        <SectionPageLayout.Actions>
          <button type='button'>Create</button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <p>Table content</p>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    ))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'A long workspace title with a model version suffix'
    )
    expect(screen.getByText('Page context')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeVisible()
    const main = screen.getByRole('main')
    expect(within(main).getByText('Table content')).toBeVisible()
    expect(screen.getByText('Table content').parentElement).toHaveClass(
      'min-h-0',
      'flex-1',
      'overflow-hidden'
    )
  })
})
