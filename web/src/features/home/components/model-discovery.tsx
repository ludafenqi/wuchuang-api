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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useStatus } from '@/hooks/use-status'
import { getModuleAccessFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export function ModelDiscovery() {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const user = useAuthStore((state) => state.auth.user)
  const access = getModuleAccessFromStatus(status, 'pricing')
  const canView = access.enabled && (!access.requireAuth || !!user)
  const catalog = usePricingData(!loading && canView)

  let content = (
    <EmptyState
      icon={Boxes}
      title={t('No models available yet')}
      description={t(
        'Available models will appear here when the catalog is configured.'
      )}
    />
  )
  if (!canView) {
    content = (
      <EmptyState
        icon={Boxes}
        title={t('Discover models')}
        description={t(
          'Visit the model catalog to check access and available models.'
        )}
        action={
          access.enabled ? (
            <Button variant='outline' render={<Link to='/pricing' />}>
              {t('Model Square')}
            </Button>
          ) : undefined
        }
      />
    )
  } else if (loading || catalog.isLoading) {
    content = <LoadingState />
  } else if (catalog.error) {
    content = (
      <ErrorState
        title={t('Failed to load model pricing')}
        onRetry={() => {
          void catalog.refetch()
        }}
      />
    )
  } else if (catalog.models.length) {
    content = (
      <ul className='wucora-model-list' aria-label={t('Model Square')}>
        {catalog.models.slice(0, 6).map((model, index) => (
          <li key={model.model_name}>
            <Link
              to='/pricing'
              search={{ search: model.model_name }}
              className='wucora-model-link'
            >
              <span className='wucora-model-monogram' aria-hidden='true'>
                {model.model_name.charAt(0).toUpperCase()}
              </span>
              <div className='wucora-model-name'>
                <h3>{model.model_name}</h3>
                <p>{model.vendor_name || t('View model details')}</p>
              </div>
              <span className='wucora-model-number' aria-hidden='true'>
                0{index + 1}
              </span>
              <ArrowUpRight aria-hidden='true' />
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section
      id='discover'
      className='wucora-discovery wucora-container'
      aria-labelledby='discover-title'
    >
      <div className='wucora-section-heading'>
        <div>
          <p className='wucora-eyebrow'>01 / {t('Model discovery')}</p>
          <h2 id='discover-title'>{t('Find your next model.')}</h2>
        </div>
        <p>
          {t(
            'Explore available models, compare pricing, and find the right API for your application.'
          )}
        </p>
      </div>
      {content}
      {access.enabled && (
        <div className='wucora-catalog-link'>
          <Link to='/pricing'>
            {t('View models and pricing')}
            <ArrowUpRight aria-hidden='true' />
          </Link>
          <span>{t('Availability and pricing follow the live catalog.')}</span>
        </div>
      )}
    </section>
  )
}
