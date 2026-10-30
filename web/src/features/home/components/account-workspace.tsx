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
import { ArrowUpRight, KeyRound, ReceiptText, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function AccountWorkspace(props: {
  isAuthenticated: boolean
  registrationEnabled: boolean
}) {
  const { t } = useTranslation()
  const items = [
    {
      icon: KeyRound,
      title: t('API Keys'),
      description: t(
        'Create and manage the keys that connect your applications.'
      ),
      to: '/keys',
    },
    {
      icon: ReceiptText,
      title: t('Usage Logs'),
      description: t('Review requests and usage from your account.'),
      to: '/usage-logs',
    },
    {
      icon: Wallet,
      title: t('Wallet'),
      description: t(
        'Manage your balance and view the plans available to your account.'
      ),
      to: '/wallet',
    },
  ]
  return (
    <>
      <section
        id='workspace'
        className='wucora-workspace wucora-container'
        aria-labelledby='workspace-title'
      >
        <div className='wucora-workspace-intro'>
          <p className='wucora-eyebrow'>03 / {t('Your workspace')}</p>
          <h2 id='workspace-title'>{t('Clarity, from key to usage.')}</h2>
          <p>
            {t(
              'Everything you need to move from your first request to everyday work.'
            )}
          </p>
        </div>
        <div className='wucora-workspace-links'>
          {items.map((item) => (
            <Link key={item.to} to={item.to} className='wucora-workspace-link'>
              <item.icon aria-hidden='true' />
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <ArrowUpRight aria-hidden='true' />
            </Link>
          ))}
        </div>
      </section>
      <section
        className='wucora-start wucora-container'
        aria-labelledby='start-title'
      >
        <div>
          <p className='wucora-eyebrow'>{t('From idea to API')}</p>
          <h2 id='start-title'>{t('Your next idea starts here.')}</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            {t('Choose a model')}
          </li>
          <li>
            <span>02</span>
            {t('Create an API key')}
          </li>
          <li>
            <span>03</span>
            {t('Connect your application')}
          </li>
        </ol>
        <div className='wucora-actions'>
          {(props.isAuthenticated || props.registrationEnabled) && (
            <Button
              size='lg'
              render={
                <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
              }
            >
              {props.isAuthenticated
                ? t('Go to Dashboard')
                : t('Create an account')}
              <ArrowUpRight aria-hidden='true' />
            </Button>
          )}
          <Button size='lg' variant='outline' render={<Link to='/pricing' />}>
            {t('View Pricing')}
          </Button>
        </div>
      </section>
    </>
  )
}
