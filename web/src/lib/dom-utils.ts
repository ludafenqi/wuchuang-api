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
import { SITE_BRAND } from '@/lib/constants'
import { resolveBrandLogo } from '@/lib/site-branding'
import type { SystemConfig } from '@/stores/system-config-store'

export function applySystemBrandingToDom(
  config: Pick<SystemConfig, 'systemName' | 'logo'>
): void {
  if (typeof document === 'undefined') return
  document.title = config.systemName
  document
    .querySelector('meta[name="title"]')
    ?.setAttribute('content', config.systemName)
  applyFaviconToDom(config.logo)
}

export function applyFaviconToDom(url: string) {
  if (typeof document === 'undefined') return
  const logo = resolveBrandLogo(url)
  const favicon = logo === SITE_BRAND.logo ? SITE_BRAND.favicon : logo
  try {
    const next = new URL(favicon, window.location.href).href
    const existing =
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    if (existing.length === 1 && existing[0].href === next) return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = favicon
    if (favicon === SITE_BRAND.favicon) {
      link.type = 'image/x-icon'
      link.setAttribute('sizes', '16x16 32x32 48x48')
    }
    link.addEventListener(
      'error',
      () => {
        if (link.isConnected && favicon !== SITE_BRAND.favicon) {
          applyFaviconToDom('')
        }
      },
      { once: true }
    )
    existing.forEach((l) => l.remove())
    document.head.appendChild(link)
  } catch {
    // Ignore malformed URLs
  }
}
