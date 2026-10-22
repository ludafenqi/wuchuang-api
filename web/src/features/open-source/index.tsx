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
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { OpenSourceAttribution } from '@/features/footer/brand-footer'

import { releaseSourceLinks } from './source'

export function OpenSourceNotice() {
  const { t } = useTranslation()
  const source = releaseSourceLinks(
    import.meta.env.VITE_SOURCE_REVISION,
    import.meta.env.VITE_REACT_APP_VERSION
  )
  return (
    <PublicLayout>
      <article className='mx-auto max-w-4xl space-y-8 py-10 pb-16 text-sm leading-7 break-words'>
        <header className='space-y-3'>
          <p className='text-muted-foreground'>晤创AI</p>
          <h1 className='text-3xl font-semibold'>{t('Open-source notice')}</h1>
          <p>
            {t(
              'Wuchuang AI provides AI model aggregation and API services. This service is a customized version of New API, independently operated by Wuchuang AI.'
            )}
          </p>
          <a className='text-primary underline' href='https://wcai.113901.xyz'>
            https://wcai.113901.xyz
          </a>
          {source.ref ? (
            <p className='text-muted-foreground'>
              {t('Source revision')}: <code>{source.ref}</code>
            </p>
          ) : (
            <p className='text-muted-foreground'>
              {t(
                'The build source revision is unavailable. Repository links may not match this release.'
              )}
            </p>
          )}
        </header>
        <section className='space-y-3'>
          <h2 className='text-xl font-semibold'>
            {t('Upstream project and contributors')}
          </h2>
          <p>
            {t(
              'New API is an open-source AI gateway and model aggregation platform by QuantumNous and contributors, based on One API by JustSong and contributors.'
            )}
          </p>
          <p>Copyright (c) QuantumNous and contributors.</p>
          <OpenSourceAttribution />
          <div className='flex flex-wrap gap-5'>
            <a
              className='text-primary underline'
              href='https://github.com/QuantumNous/new-api/graphs/contributors'
              target='_blank'
              rel='noopener noreferrer'
            >
              {t('New API contributors')}
            </a>
            <a
              className='text-primary underline'
              href='https://github.com/songquanpeng/one-api'
              target='_blank'
              rel='noopener noreferrer'
            >
              One API · JustSong
            </a>
          </div>
        </section>
        <section className='space-y-3'>
          <h2 className='text-xl font-semibold'>
            {t('License and source code')}
          </h2>
          <p>
            {t(
              'This modified program is provided under the GNU Affero General Public License v3.0 (AGPLv3), without warranty. You may obtain, study, modify and redistribute its corresponding source under the license terms.'
            )}
          </p>
          <p>
            {t(
              'Users interacting with a modified version over a network must be offered its corresponding source. Distribution of Docker images or binaries must also satisfy AGPLv3 source-delivery requirements and preserve license and attribution notices.'
            )}
          </p>
          <div className='flex flex-wrap gap-5'>
            <a
              className='text-primary underline'
              href={source.source}
              target='_blank'
              rel='noopener noreferrer'
            >
              {t('Corresponding source code')}
            </a>
            <a
              className='text-primary underline'
              href={source.license}
              target='_blank'
              rel='noopener noreferrer'
            >
              AGPLv3 · LICENSE
            </a>
            <a
              className='text-primary underline'
              href={source.notice}
              target='_blank'
              rel='noopener noreferrer'
            >
              NOTICE
            </a>
          </div>
        </section>
        <section className='space-y-3'>
          <h2 className='text-xl font-semibold'>
            {t('Wuchuang AI modifications')}
          </h2>
          <p className='text-muted-foreground'>
            <time dateTime='2026-10-22'>2026-10-22</time> · 晤创AI
          </p>
          <p>
            {t(
              'Wuchuang AI customizes site branding, footer layouts, visual footer management and this notice. These changes do not imply endorsement by New API or QuantumNous. Modification history and build sources are available in the project repository.'
            )}
          </p>
          <a
            className='text-primary underline'
            href={source.history}
            target='_blank'
            rel='noopener noreferrer'
          >
            {t('Modification history')}
          </a>
        </section>
        <section className='space-y-3'>
          <h2 className='text-xl font-semibold'>{t('Third-party licenses')}</h2>
          <p>
            {t(
              'This software includes third-party components under their respective licenses. The dependency inventory and license notices are available in THIRD-PARTY-LICENSES.md; Apache notices and Electron/Chromium attribution requirements are recorded in NOTICE.'
            )}
          </p>
          <a
            className='text-primary underline'
            href={source.thirdParty}
            target='_blank'
            rel='noopener noreferrer'
          >
            THIRD-PARTY-LICENSES.md
          </a>
        </section>
      </article>
    </PublicLayout>
  )
}
