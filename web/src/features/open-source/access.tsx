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

// Outside configurable Footer/About content: the required legal entry cannot
// disappear when either setting is empty, replaced or disabled.
export function OpenSourceAccess() {
  const { t } = useTranslation()
  return (
    <aside aria-label={t('Legal')} className='fixed bottom-2 left-2 z-30'>
      <Link
        to='/open-source'
        className='bg-background text-muted-foreground hover:text-foreground inline-flex min-h-8 items-center rounded-lg border px-3 py-1 text-xs shadow-sm focus-visible:outline-2'
      >
        {t('Open-source notice')}
      </Link>
    </aside>
  )
}
