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
import { ArrowDown, ArrowUpRight, Boxes, Code2, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useSystemConfig } from '@/hooks/use-system-config'

export function LandingHero(props: {
  isAuthenticated: boolean
  registrationEnabled: boolean
}) {
  const { t } = useTranslation()
  const system = useSystemConfig()
  const destination = props.isAuthenticated ? '/dashboard' : '/sign-up'

  return (
    <section className='wucora-hero' aria-labelledby='home-title'>
      <div className='wucora-container'>
        <p className='wucora-eyebrow'>
          <span aria-hidden='true' />
          {t('Your AI, connected.')}
        </p>
        <div className='wucora-hero-stage'>
          <div className='wucora-hero-message'>
            <h1 id='home-title'>
              {t('Connect intelligence.')}
              <br />
              <em>{t('Create what’s next.')}</em>
            </h1>
            <p className='wucora-hero-description'>
              {t(
                'Discover AI models, connect through a unified API, and manage your usage in one place.'
              )}
            </p>
            <div className='wucora-actions'>
              {(props.isAuthenticated || props.registrationEnabled) && (
                <Button size='lg' render={<Link to={destination} />}>
                  {props.isAuthenticated
                    ? t('Go to Dashboard')
                    : t('Get Started')}
                  <ArrowUpRight aria-hidden='true' />
                </Button>
              )}
              <Button
                size='lg'
                variant='outline'
                render={<Link to='/pricing' />}
              >
                {t('Explore models')}
              </Button>
            </div>
          </div>
          <div className='wucora-aperture' aria-hidden='true'>
            <div className='wucora-orbit wucora-orbit-outer' />
            <div className='wucora-orbit wucora-orbit-inner' />
            <div className='wucora-aperture-core'>
              <img src={system.logo} alt='' />
              <span>{system.systemName}</span>
            </div>
            <span className='wucora-orbit-node wucora-node-code'>
              <Code2 /> API
            </span>
            <span className='wucora-orbit-node wucora-node-model'>
              <Boxes />
            </span>
            <span className='wucora-orbit-node wucora-node-network'>
              <Network />
            </span>
            <span className='wucora-orbit-caption'>
              {t('One gateway. Every model.')}
            </span>
          </div>
        </div>
        <nav
          className='wucora-section-index'
          aria-label={t('Explore the platform')}
        >
          <a href='#discover'>
            <span>01</span>
            {t('Discover models')}
            <ArrowDown aria-hidden='true' />
          </a>
          <a href='#connect'>
            <span>02</span>
            {t('Connect your application')}
            <ArrowDown aria-hidden='true' />
          </a>
          <a href='#workspace'>
            <span>03</span>
            {t('Manage your workspace')}
            <ArrowDown aria-hidden='true' />
          </a>
        </nav>
      </div>
    </section>
  )
}
