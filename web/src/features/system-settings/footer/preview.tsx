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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  BrandFooter,
  type BrandFooterProps,
} from '@/features/footer/brand-footer'
import { cn } from '@/lib/utils'

export function FooterPreview(props: BrandFooterProps) {
  const { t } = useTranslation()
  const [mobile, setMobile] = useState(false)
  const [dark, setDark] = useState(false)
  return (
    <section aria-label={t('Live preview')} className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='mr-auto font-semibold'>{t('Live preview')}</h2>
        <Button
          type='button'
          variant='outline'
          aria-pressed={!mobile}
          onClick={() => setMobile(false)}
        >
          {t('Desktop')}
        </Button>
        <Button
          type='button'
          variant='outline'
          aria-pressed={mobile}
          onClick={() => setMobile(true)}
        >
          {t('Mobile')}
        </Button>
        <Button
          type='button'
          variant='outline'
          aria-pressed={dark}
          onClick={() => setDark(!dark)}
        >
          {t('Dark mode')}
        </Button>
      </div>
      <div
        className={cn(
          'footer-preview overflow-hidden rounded-xl border',
          dark ? 'dark' : 'footer-preview-light'
        )}
      >
        <div
          className={cn(
            'bg-background text-foreground mx-auto max-w-full',
            mobile && 'w-[375px]'
          )}
        >
          {!props.config.enabled && (
            <p className='p-6 text-sm'>
              {t(
                'The footer is hidden. The open-source notice remains accessible.'
              )}
            </p>
          )}
          <div inert>
            <BrandFooter {...props} />
          </div>
        </div>
      </div>
    </section>
  )
}
