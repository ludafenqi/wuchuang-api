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
import { useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { FooterNoticeContext } from './footer-notice'

export function FooterNoticeProvider(props: { children: ReactNode }) {
  const [present, setPresent] = useState(false)
  return (
    <FooterNoticeContext.Provider value={{ present, setPresent }}>
      {props.children}
    </FooterNoticeContext.Provider>
  )
}

// Composed only by the public home. Keep a legal entry even when its
// administrator-configured business footer is disabled.
export function OpenSourceAccess() {
  const { t } = useTranslation()
  const footer = useContext(FooterNoticeContext)
  if (!footer || footer.present) {
    return null
  }
  return (
    <aside
      aria-label={t('Legal')}
      className='bg-background text-muted-foreground border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs'
    >
      <Link
        to='/open-source'
        className='hover:text-foreground inline-flex min-h-8 items-center px-3 underline underline-offset-4 focus-visible:outline-2'
      >
        {t('Open-source notice')}
      </Link>
    </aside>
  )
}
