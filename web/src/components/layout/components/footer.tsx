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
import { BrandFooter } from '@/features/footer/brand-footer'
import { parseFooterConfig } from '@/features/footer/config'
import { useSiteFooterNotice } from '@/features/open-source/footer-notice'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { DEFAULT_SYSTEM_NAME, SITE_BRAND } from '@/lib/constants'

import { DemoFooter } from './demo-footer'

export function Footer(props: { className?: string }) {
  const system = useSystemConfig()
  const { status } = useStatus()
  const config = parseFooterConfig(status?.footer_config)
  const demo = system.demoSiteEnabled && !status?.footer_config
  useSiteFooterNotice(!demo && config.enabled)
  // Preserve the upstream demonstration site's project navigation and attribution.
  if (demo) {
    return <DemoFooter {...props} />
  }
  return (
    <BrandFooter
      config={config}
      name={
        system.systemName && system.systemName !== DEFAULT_SYSTEM_NAME
          ? system.systemName
          : SITE_BRAND.name
      }
      logo={system.logo}
      legacyHtml={system.footerHtml}
      availability={{
        docsLink: status?.docs_link,
        agreementEnabled: status?.user_agreement_enabled,
        privacyEnabled: status?.privacy_policy_enabled,
      }}
      className={props.className}
    />
  )
}
