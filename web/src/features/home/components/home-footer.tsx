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
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Footer } from '@/components/layout/components/footer'
import {
  FooterNoticeProvider,
  OpenSourceAccess,
} from '@/features/open-source/access'
import { HomeOpenSourceNotice } from '@/features/open-source/home-notice'

export function HomeFooter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash === 'open-source') {
      void queryClient.invalidateQueries({ queryKey: ['status'] })
    }
  }, [hash, queryClient])
  return (
    <div className='wucora-home-footer'>
      <FooterNoticeProvider>
        <Footer />
        <OpenSourceAccess />
      </FooterNoticeProvider>
      <Dialog
        title={t('Open-source notice')}
        open={hash === 'open-source'}
        onOpenChange={(open) => {
          if (!open) void navigate({ hash: '', replace: true, search: true })
        }}
        contentClassName='sm:max-w-3xl'
        contentHeight='min(70svh, 640px)'
      >
        <HomeOpenSourceNotice />
      </Dialog>
    </div>
  )
}
