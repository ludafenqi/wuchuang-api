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

/** Keep source builds identifiable without inventing a release for update comparisons. */
export function getBuildVersion(
  status?: { version?: unknown; source_revision?: unknown } | null,
  clientRevision = import.meta.env.VITE_SOURCE_REVISION
): { label?: string; revision?: string } {
  const version =
    typeof status?.version === 'string' ? status.version.trim() : ''
  const source =
    typeof status?.source_revision === 'string'
      ? status.source_revision.trim()
      : ''
  const revision = [source, clientRevision].find(
    (value) => value && /^[a-f\d]{7,64}$/i.test(value)
  )
  if (version && version !== 'v0.0.0' && version !== '0.0.0') {
    return { label: version, revision }
  }
  return {
    label: revision ? `git.${revision.slice(0, 12)}` : undefined,
    revision,
  }
}
