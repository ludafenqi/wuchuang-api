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

export type BrandLogoVariant = 'compact' | 'decoration'

/** Resolve only bundled, same-origin logo aliases; custom branding stays intact. */
export function resolveBrandLogo(
  logo: string,
  variant: BrandLogoVariant = 'compact'
): string {
  const fallback =
    variant === 'decoration' ? SITE_BRAND.decorationLogo : SITE_BRAND.logo
  const source = typeof logo === 'string' ? logo.trim() : ''
  if (!source) return fallback

  try {
    const origin =
      typeof window === 'undefined'
        ? 'http://localhost'
        : window.location.origin
    const url = new URL(source, origin)
    if (
      url.origin === origin &&
      ['/wucora-logo.png', SITE_BRAND.logo, SITE_BRAND.decorationLogo].includes(
        url.pathname
      )
    ) {
      return fallback
    }
  } catch {
    // Preserve invalid custom URLs; the image's error handler owns its fallback.
  }
  return source
}
