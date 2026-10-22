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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HtmlContent } from '@/components/html-content'
import { cn } from '@/lib/utils'

import {
  isSafeFooterUrl,
  visibleFooterLinks,
  type FooterAvailability,
  type FooterConfig,
  type FooterLink,
} from './config'

export function OpenSourceAttribution() {
  const { t } = useTranslation()
  return (
    <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs leading-relaxed'>
      <p>Frontend design and development by New API contributors.</p>
      <div className='flex flex-wrap gap-4'>
        <a
          href='https://github.com/QuantumNous/new-api'
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-foreground underline underline-offset-4'
        >
          New API
        </a>
        <Link
          to='/open-source'
          className='hover:text-foreground underline underline-offset-4'
        >
          {t('Open-source notice')}
        </Link>
      </div>
    </div>
  )
}

function NavigationLink(props: { link: FooterLink }) {
  const { t } = useTranslation()
  const className =
    'text-muted-foreground hover:text-foreground break-words text-sm transition-colors'
  if (props.link.external) {
    return (
      <a
        href={props.link.url}
        target='_blank'
        rel='noopener noreferrer'
        className={className}
      >
        {t(props.link.label)}
      </a>
    )
  }
  return (
    <Link to={props.link.url} className={className}>
      {t(props.link.label)}
    </Link>
  )
}

export type BrandFooterProps = {
  config: FooterConfig
  name: string
  logo?: string
  legacyHtml?: string
  availability?: FooterAvailability
  className?: string
}

export function BrandFooter(props: BrandFooterProps) {
  const { t } = useTranslation()
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear())
  useEffect(() => {
    const timer = window.setInterval(
      () => setCurrentYear(new Date().getFullYear()),
      60_000
    )
    return () => window.clearInterval(timer)
  }, [])
  if (!props.config.enabled) return null
  const config = props.config
  const links = visibleFooterLinks(config, props.availability ?? {})
  const groups = [...new Set(links.map((link) => link.group))]
  const hasLegacy = !!props.legacyHtml && config.legacyMode !== 'ignore'
  const showBrand = !hasLegacy || config.legacyMode === 'append'
  const logo =
    props.logo &&
    (isSafeFooterUrl(props.logo, true) || isSafeFooterUrl(props.logo, false))
      ? props.logo
      : '/logo.png'
  return (
    <footer
      className={cn(
        '@container border-border/60 text-foreground relative border-t',
        config.background === 'theme' && 'bg-background',
        config.background === 'muted' && 'bg-muted',
        config.background === 'accent' && 'bg-accent',
        props.className
      )}
      data-layout={config.layout}
    >
      <div className='mx-auto max-w-6xl space-y-6 px-6 py-8 @xl:px-10 @xl:py-12'>
        {showBrand && (
          <>
            <div
              className={cn(
                'grid min-w-0 gap-8',
                config.layout !== 'minimal' &&
                  '@2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
              )}
            >
              {config.layout !== 'minimal' && (
                <div className='min-w-0 space-y-3'>
                  <Link
                    to='/'
                    className='inline-flex max-w-full items-center gap-3'
                  >
                    <img
                      src={logo}
                      alt=''
                      className='size-10 shrink-0 rounded-xl object-contain'
                    />
                    <span className='text-lg font-semibold break-words'>
                      {props.name}
                    </span>
                  </Link>
                  <p className='text-muted-foreground max-w-sm text-sm leading-relaxed break-words'>
                    {t(config.description)}
                  </p>
                </div>
              )}
              <nav aria-label={t('Footer navigation')}>
                {config.layout === 'developer' ? (
                  <div className='grid grid-cols-2 gap-6 @xl:grid-cols-4'>
                    {groups.map((group) => (
                      <div key={group} className='min-w-0'>
                        <h2 className='mb-3 text-sm font-semibold break-words'>
                          {t(group || 'Links')}
                        </h2>
                        <ul className='space-y-3'>
                          {links
                            .filter((link) => link.group === group)
                            .map((link) => (
                              <li key={link.id}>
                                <NavigationLink link={link} />
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul
                    className={cn(
                      'flex flex-wrap gap-x-6 gap-y-3',
                      config.layout === 'brand' && '@2xl:justify-end'
                    )}
                  >
                    {links.map((link) => (
                      <li key={link.id} className='max-w-full min-w-0'>
                        <NavigationLink link={link} />
                      </li>
                    ))}
                  </ul>
                )}
              </nav>
            </div>
            <p className='text-muted-foreground text-sm leading-relaxed break-words'>
              © {config.autoYear ? currentYear : config.year} {props.name}.{' '}
              {t(config.copyright)}
            </p>
          </>
        )}
        {hasLegacy && (
          <HtmlContent
            content={props.legacyHtml ?? ''}
            variant='isolated'
            className='custom-footer min-w-0 overflow-hidden [contain:paint]'
          />
        )}
        <OpenSourceAttribution />
      </div>
    </footer>
  )
}
