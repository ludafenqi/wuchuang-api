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
const repository = 'https://github.com/ludafenqi/wuchuang-api'

// Prefer the exact frontend build commit. Older/tagged builds can use their
// release tag; unidentified builds explicitly disclose the unpinned fallback.
export function releaseSourceLinks(revision: unknown, version: unknown) {
  const commit =
    typeof revision === 'string' && /^[a-f\d]{40}$/i.test(revision)
      ? revision
      : ''
  const tag =
    typeof version === 'string' &&
    /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) &&
    !/^v?0\.0\.0$/.test(version)
      ? version
      : ''
  const ref = commit || tag
  const blob = `${repository}/blob/${ref || 'HEAD'}`
  return {
    ref,
    source: ref ? `${repository}/tree/${ref}` : repository,
    license: `${blob}/LICENSE`,
    notice: `${blob}/NOTICE`,
    thirdParty: `${blob}/THIRD-PARTY-LICENSES.md`,
    history: `${repository}/commits/${ref || 'HEAD'}`,
  }
}
