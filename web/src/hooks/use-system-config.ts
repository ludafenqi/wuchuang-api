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
import { useEffect, useCallback } from 'react'

import { DEFAULT_LOGO, SITE_BRAND } from '@/lib/constants'
import { applyFaviconToDom } from '@/lib/dom-utils'
import { resolveBrandLogo } from '@/lib/site-branding'
import { ensureStatus } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

interface UseSystemConfigOptions {
  /** Automatically fetch config from backend (use only in root component) */
  autoLoad?: boolean
}

/** Preload an image, returning a cleanup that detaches the pending handlers. */
function preloadImage(
  src: string,
  onLoad: () => void,
  onError: () => void
): () => void {
  const img = new Image()
  img.onload = onLoad
  img.onerror = onError
  img.src = src

  return () => {
    img.onload = null
    img.onerror = null
  }
}

/**
 * System configuration hook with auto-loading and logo preloading
 *
 * @example
 * // Root component - auto-load from backend
 * useSystemConfig({ autoLoad: true })
 *
 * @example
 * // Other components - use cached config
 * const { systemName, logo, loading } = useSystemConfig()
 */
export function useSystemConfig(options: UseSystemConfigOptions = {}) {
  const { autoLoad = false } = options
  const queryClient = useQueryClient()
  const { config, loading, loadedLogoUrl, setLoadedLogoUrl, setLoading } =
    useSystemConfigStore()
  const logo = resolveBrandLogo(config.logo)

  // Load config from backend via the shared `/api/status` cache.
  // `ensureStatus` writes the mapped config into this store itself, so there is
  // no second request and no second mapping path here.
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      await ensureStatus(queryClient)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load system config:', error)
    } finally {
      setLoading(false)
    }
  }, [queryClient, setLoading])

  useEffect(() => {
    if (autoLoad) loadConfig()
  }, [autoLoad, loadConfig])

  // Preload the displayed image. main.tsx owns favicon updates from config;
  // image completion must never replace the independent default favicon.
  useEffect(() => {
    // Skip if logo is already loaded
    if (!logo || logo === loadedLogoUrl) return

    // Preload new logo
    return preloadImage(
      logo,
      () => {
        setLoadedLogoUrl(logo)
      },
      () => {
        if (logo !== DEFAULT_LOGO && logo !== SITE_BRAND.logo) {
          // eslint-disable-next-line no-console
          console.error('Failed to load logo:', logo)
          if (
            resolveBrandLogo(useSystemConfigStore.getState().config.logo) ===
            logo
          ) {
            applyFaviconToDom('')
          }
        }
        // Mark as loaded even on error to prevent infinite retry
        setLoadedLogoUrl(logo)
      }
    )
  }, [logo, loadedLogoUrl, setLoadedLogoUrl])

  return {
    ...config,
    logo,
    loading,
    logoLoaded: logo === loadedLogoUrl && !!loadedLogoUrl,
  }
}
