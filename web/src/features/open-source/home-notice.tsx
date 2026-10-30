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

import { EmptyState } from '@/components/empty-state'
import { Markdown } from '@/components/ui/markdown'
import { parseFooterConfig } from '@/features/footer/config'
import { useStatus } from '@/hooks/use-status'

export function HomeOpenSourceNotice() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const content = parseFooterConfig(status?.footer_config).openSourceNotice
  if (!content?.trim()) {
    return <EmptyState title={t('No open-source notice configured')} />
  }
  return (
    <Markdown
      breaks
      baseUrl={window.location.origin}
      className='min-w-0 [overflow-wrap:anywhere]'
    >
      {content}
    </Markdown>
  )
}
