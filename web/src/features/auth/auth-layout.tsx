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
import { ArrowRight, Boxes, Code2, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SystemBrand } from '@/components/layout/components/system-brand'
import { ThemeSwitch } from '@/components/theme-switch'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
  storyTitle?: string
}

export function AuthLayout(props: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()

  return (
    <div className='wcai-auth relative grid min-h-svh max-w-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      <div className='wcai-auth-brand absolute top-6 left-5 z-10 max-w-[60%] min-w-0 sm:top-8 sm:left-10'>
        <SystemBrand variant='inline' />
      </div>
      <div className='absolute top-6 right-5 z-10 flex items-center gap-2 sm:top-8 sm:right-10'>
        <LanguageSwitcher />
        <ThemeSwitch />
      </div>
      <aside className='wcai-auth-story hidden min-w-0 flex-col justify-center px-12 pt-32 pb-16 lg:flex xl:px-20'>
        <p className='mb-5 text-xs font-medium tracking-[0.16em] uppercase'>
          {t('Unified AI infrastructure')}
        </p>
        <h2
          className={
            props.storyTitle !== undefined
              ? 'max-w-none text-3xl leading-[1.25] font-semibold tracking-tight whitespace-nowrap xl:text-[clamp(1.875rem,2.5vw,2.25rem)]'
              : 'max-w-lg text-4xl leading-[1.25] font-semibold tracking-tight text-balance whitespace-pre-line xl:text-5xl'
          }
        >
          {props.storyTitle ?? t('One gateway. Every model.')}
        </h2>
        <p className='mt-6 max-w-md text-base leading-relaxed opacity-80'>
          {t('Build, connect, and scale your AI applications.')}
        </p>
        <div
          className='wcai-auth-flow mt-12 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border p-5'
          aria-hidden='true'
        >
          <div className='flex min-w-0 flex-col gap-3'>
            <Code2 className='size-6' />
            <span className='text-xs'>{t('Your application')}</span>
          </div>
          <ArrowRight className='size-5 opacity-50' />
          <div className='flex min-w-0 flex-col gap-3'>
            <Network className='size-6' />
            <span className='text-sm font-semibold break-words'>
              {systemName}
            </span>
          </div>
          <div className='col-span-3 mt-3 flex items-center gap-3 border-t pt-4 text-xs'>
            <Boxes className='size-5' />
            <span>OpenAI · Claude · Gemini · DeepSeek</span>
          </div>
        </div>
        <Link
          to='/pricing'
          className='mt-8 inline-flex w-fit items-center gap-2 text-sm underline-offset-4 hover:underline'
        >
          {t('Explore models')}
          <ArrowRight className='size-4' aria-hidden='true' />
        </Link>
      </aside>
      <main className='wcai-auth-content flex min-w-0 items-center justify-center px-5 pt-28 pb-12 sm:px-10 lg:py-28'>
        <div className='wcai-auth-panel mx-auto flex w-full max-w-[420px] flex-col justify-center space-y-2'>
          {props.children}
        </div>
      </main>
    </div>
  )
}
