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
import { describe, expect, it } from 'vitest'

import { releaseSourceLinks } from '../source'

describe('release source links', () => {
  it('pins every corresponding source and license link to the exact build commit', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const links = releaseSourceLinks(sha, 'v1.2.3')
    expect(links.source).toBe(
      `https://github.com/ludafenqi/wuchuang-api/tree/${sha}`
    )
    expect(links.license).toBe(
      `https://github.com/ludafenqi/wuchuang-api/blob/${sha}/LICENSE`
    )
    expect(links.notice).toBe(
      `https://github.com/ludafenqi/wuchuang-api/blob/${sha}/NOTICE`
    )
    expect(links.thirdParty).toBe(
      `https://github.com/ludafenqi/wuchuang-api/blob/${sha}/THIRD-PARTY-LICENSES.md`
    )
    expect(links.history).toBe(
      `https://github.com/ludafenqi/wuchuang-api/commits/${sha}`
    )
  })
  it('falls back to a release tag for older builds without commit metadata', () => {
    expect(releaseSourceLinks(undefined, 'v1.2.3-beta.1').source).toBe(
      'https://github.com/ludafenqi/wuchuang-api/tree/v1.2.3-beta.1'
    )
  })
  it.each([
    [undefined, 'v0.0.0'],
    ['https://evil.test', 'main'],
  ])('marks unknown or unsafe metadata as unpinned', (revision, version) => {
    const links = releaseSourceLinks(revision, version)
    expect(links.ref).toBe('')
    expect(links.source).toBe('https://github.com/ludafenqi/wuchuang-api')
  })
})
