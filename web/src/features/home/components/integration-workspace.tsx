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
import { ArrowUpRight, Check, Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

export function IntegrationWorkspace() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const serverAddress =
    typeof status?.server_address === 'string' ? status.server_address : ''
  const baseUrl = (serverAddress || window.location.origin).replace(/\/+$/, '')
  const environment = `OPENAI_BASE_URL=${baseUrl}/v1\nOPENAI_API_KEY=YOUR_API_KEY`
  const docs =
    typeof status?.docs_link === 'string' && status.docs_link
      ? status.docs_link
      : 'https://docs.newapi.pro'

  return (
    <section
      id='connect'
      className='wucora-integration'
      aria-labelledby='connect-title'
    >
      <div className='wucora-container wucora-integration-grid'>
        <div className='wucora-integration-copy'>
          <p className='wucora-eyebrow'>02 / {t('Built to connect')}</p>
          <h2 id='connect-title'>
            {t('Less integration.')}
            <br />
            {t('More creation.')}
          </h2>
          <p>
            {t(
              'Use a single API entry point. Keep model discovery, API keys, and request logs in the same workspace.'
            )}
          </p>
          <Button
            variant='outline'
            size='lg'
            render={<a href={docs} target='_blank' rel='noopener noreferrer' />}
          >
            {t('API Documentation')}
            <ArrowUpRight aria-hidden='true' />
          </Button>
        </div>
        <div className='wucora-connection-panel'>
          <div className='wucora-panel-heading'>
            <Code2 aria-hidden='true' />
            <span>{t('Connection settings')}</span>
            <span className='wucora-file-type'>.env</span>
          </div>
          <div className='wucora-code-label'>
            <span>{t('API Base URL')}</span>
            <CopyButton
              value={`${baseUrl}/v1`}
              aria-label={t('Copy API base URL')}
            />
          </div>
          <code className='wucora-base-url'>
            {baseUrl}
            <strong>/v1</strong>
          </code>
          <p className='wucora-code-label'>
            {t('Environment variables')}
            <CopyButton
              value={environment}
              aria-label={t('Copy connection settings')}
            />
          </p>
          <pre tabIndex={0} aria-label={t('Environment variables')}>
            <code>
              <span>OPENAI_BASE_URL</span>={baseUrl}/v1{'\n'}
              <span>OPENAI_API_KEY</span>=YOUR_API_KEY
            </code>
          </pre>
          <p className='wucora-code-note'>
            <Check aria-hidden='true' />
            {t(
              'Create a key in your account, then follow the documentation for your model’s protocol.'
            )}
          </p>
        </div>
      </div>
    </section>
  )
}
