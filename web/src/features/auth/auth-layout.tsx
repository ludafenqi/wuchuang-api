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
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <div className='wcai-auth relative grid min-h-svh max-w-none lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'>
      <Link
        to='/'
        className='wcai-auth-brand absolute top-5 left-5 z-10 flex items-center gap-3 transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        <div className='relative h-8 w-8'>
          {loading ? (
            <Skeleton className='absolute inset-0 rounded-full' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='h-8 w-8 rounded-full object-cover'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <h1 className='text-xl font-medium'>{systemName}</h1>
        )}
      </Link>
      <div
        className='wcai-auth-art relative hidden min-h-svh overflow-hidden lg:flex'
        aria-hidden='true'
      >
        <div className='wcai-auth-grid absolute inset-0' />
        <div className='wcai-auth-orbit absolute inset-0 m-auto'>
          <span className='wcai-auth-orbit-ring' />
          <span className='wcai-auth-orbit-ring' />
          <span className='wcai-auth-orbit-ring' />
          <span className='wcai-auth-core' />
          <span className='wcai-auth-node' />
          <span className='wcai-auth-node' />
          <span className='wcai-auth-node' />
        </div>
        <span className='wcai-auth-wordmark absolute right-10 bottom-12 left-10 text-5xl font-semibold tracking-tight'>
          {systemName}
        </span>
      </div>
      <div className='wcai-auth-content flex min-w-0 items-center justify-center px-5 pt-28 pb-12 sm:px-10 lg:py-20'>
        <div className='wcai-auth-panel mx-auto flex w-full max-w-[480px] flex-col justify-center space-y-2 px-6 py-8 sm:p-10'>
          {children}
        </div>
      </div>
    </div>
  )
}
