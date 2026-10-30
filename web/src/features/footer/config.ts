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
import { z } from 'zod'

export function isSafeFooterUrl(value: string, external: boolean): boolean {
  if (!value) return true
  if (value.length > 2048) return false
  try {
    let decoded = value
    for (let i = 0; i < 4; i++) {
      if (
        [...decoded].some(
          (char) =>
            char.charCodeAt(0) <= 32 ||
            char.charCodeAt(0) === 127 ||
            char === '\\'
        )
      ) {
        return false
      }
      if (!external && (!decoded.startsWith('/') || decoded.startsWith('//'))) {
        return false
      }
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    const url = new URL(value, 'https://footer.invalid')
    if (url.username || url.password) return false
    if (external) return /^https?:\/\//.test(value) && !!url.hostname
    return url.origin === 'https://footer.invalid'
  } catch {
    return false
  }
}

export const footerLinkSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    url: z.string().max(2048),
    group: z.string().max(40),
    visible: z.boolean(),
    external: z.boolean(),
    source: z.enum([
      'custom',
      'models',
      'pricing',
      'docs',
      'about',
      'agreement',
      'privacy',
      'open-source',
    ]),
  })
  .refine((link) => isSafeFooterUrl(link.url, link.external), {
    message: 'Invalid footer configuration',
    path: ['url'],
  })

export const footerConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    layout: z.enum(['brand', 'developer', 'minimal']),
    description: z.string().max(500),
    copyright: z.string().max(200),
    openSourceNotice: z.string().max(12000).optional(),
    autoYear: z.boolean(),
    year: z.string().regex(/^(?:\d{4}(?:-\d{4})?)?$/),
    background: z.enum(['theme', 'muted', 'accent']),
    legacyMode: z.enum(['replace', 'append', 'ignore']),
    links: z.array(footerLinkSchema).max(40),
  })
  .refine((config) => config.autoYear || !!config.year, {
    path: ['year'],
    message: 'Invalid footer configuration',
  })
  .refine(
    (config) =>
      new Set(config.links.map((link) => link.id)).size === config.links.length,
    { message: 'Invalid footer configuration' }
  )

export type FooterConfig = z.infer<typeof footerConfigSchema>
export type FooterLink = z.infer<typeof footerLinkSchema>

export function defaultFooterConfig(): FooterConfig {
  return {
    version: 1,
    enabled: true,
    layout: 'brand',
    description: 'AI model aggregation and API service platform',
    copyright: 'All rights reserved.',
    openSourceNotice: '',
    autoYear: true,
    year: '',
    background: 'theme',
    legacyMode: 'replace',
    links: [
      {
        id: 'models',
        label: 'Model Square',
        url: '/pricing',
        group: 'Product',
        visible: true,
        external: false,
        source: 'models',
      },
      {
        id: 'pricing',
        label: 'Pricing',
        url: '/pricing',
        group: 'Product',
        visible: true,
        external: false,
        source: 'pricing',
      },
      {
        id: 'docs',
        label: 'API Documentation',
        url: '',
        group: 'Developers',
        visible: true,
        external: true,
        source: 'docs',
      },
      {
        id: 'about',
        label: 'About Us',
        url: '/about',
        group: 'Support',
        visible: true,
        external: false,
        source: 'about',
      },
      {
        id: 'agreement',
        label: 'User Agreement',
        url: '/user-agreement',
        group: 'Legal',
        visible: true,
        external: false,
        source: 'agreement',
      },
      {
        id: 'privacy',
        label: 'Privacy Policy',
        url: '/privacy-policy',
        group: 'Legal',
        visible: true,
        external: false,
        source: 'privacy',
      },
      {
        id: 'open-source',
        label: 'Open-source notice',
        url: '/open-source',
        group: 'Legal',
        visible: true,
        external: false,
        source: 'open-source',
      },
    ],
  }
}

// Keep the original Footer value; upgrades do not overwrite custom HTML.
export function parseFooterConfig(raw: unknown): FooterConfig {
  try {
    const result = footerConfigSchema.safeParse(
      typeof raw === 'string' ? JSON.parse(raw) : raw
    )
    if (result.success) return result.data
  } catch {
    /* Damaged or older configuration uses safe defaults. */
  }
  return defaultFooterConfig()
}

export type FooterAvailability = {
  docsLink?: string
  agreementEnabled?: boolean
  privacyEnabled?: boolean
}

export function visibleFooterLinks(
  config: FooterConfig,
  availability: FooterAvailability
): FooterLink[] {
  return config.links.flatMap((link) => {
    if (!link.visible) return []
    if (link.source === 'agreement' && !availability.agreementEnabled) return []
    if (link.source === 'privacy' && !availability.privacyEnabled) return []
    const url =
      link.source === 'docs' && !link.url
        ? (availability.docsLink ?? '')
        : link.url
    if (!url || !isSafeFooterUrl(url, link.external)) return []
    return [{ ...link, url }]
  })
}
