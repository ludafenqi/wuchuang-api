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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlanRecord } from '@/features/subscriptions/types'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SubscriptionPlansCard } from '../subscription-plans-card'

const plan: PlanRecord = {
  plan: {
    id: 1,
    title: 'Developer',
    price_amount: 12,
    currency: 'USD',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'daily',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: 5000000,
  },
}
let plans: PlanRecord[]
let purchased: boolean
let client: QueryClient
beforeEach(() => {
  plans = [plan]
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  purchased = false
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: plans } }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: {
            billing_preference: 'wallet_first',
            subscriptions: [],
            all_subscriptions: purchased
              ? [
                  {
                    subscription: {
                      id: 1,
                      plan_id: 1,
                      user_id: 1,
                      status: 'expired',
                      start_time: 0,
                      end_time: 1,
                      amount_total: 0,
                      amount_used: 0,
                    },
                  },
                ]
              : [],
          },
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
})
afterEach(() => {
  client.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

function renderPlans(props: ComponentProps<typeof SubscriptionPlansCard>) {
  return render(
    <QueryClientProvider client={client}>
      <SubscriptionPlansCard {...props} />
    </QueryClientProvider>
  )
}

describe('subscription plan presentation', () => {
  it('keeps the configured price and benefits and opens the existing purchase dialog for a single plan', async () => {
    const user = userEvent.setup()
    renderPlans({ topupInfo: null, userQuota: 0 })
    expect(
      await screen.findByRole('heading', { name: 'Developer' })
    ).toBeVisible()
    expect(screen.getByText('$12.00')).toBeVisible()
    expect(screen.getByText(/^Total Quota:/)).toHaveTextContent(
      /\$10(?:\.0+)?$/
    )
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subscribe Now' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Developer')).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: 'Pay with Balance' })
    ).toBeDisabled()
  })

  it('preserves purchase limits while presenting multiple plans', async () => {
    plans = [
      { plan: { ...plan.plan, max_purchase_per_user: 1 } },
      { plan: { ...plan.plan, id: 2, title: 'Team', price_amount: 30 } },
    ]
    purchased = true
    renderPlans({ topupInfo: null })
    expect(await screen.findByText('Recommended')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Limit Reached' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Subscribe Now' })).toBeEnabled()
    expect(screen.getByText('$30.00')).toBeVisible()
  })

  it('does not manufacture plans when the server returns an empty catalog', async () => {
    plans = []
    const available = vi.fn()
    renderPlans({ topupInfo: null, onAvailabilityChange: available })
    await waitFor(() => expect(available).toHaveBeenLastCalledWith(false))
    expect(
      screen.queryByRole('button', { name: 'Subscribe Now' })
    ).not.toBeInTheDocument()
  })
})
