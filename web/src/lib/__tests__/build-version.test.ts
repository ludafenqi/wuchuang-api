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

import { getBuildVersion } from '../build-version'

const revision = '5ce47e8883c5ca51382699d2e60bbc6db6daadb7'

describe('build identity', () => {
  it.each(['', 'v0.0.0', '0.0.0'])(
    'identifies a source build with version %s using its real server commit',
    (version) => {
      expect(
        getBuildVersion({ version, source_revision: revision }, 'abcdef1234567')
      ).toEqual({
        label: 'git.5ce47e8883c5',
        revision,
      })
    }
  )
  it('preserves the actual release version alongside the source commit', () => {
    expect(
      getBuildVersion(
        { version: 'v1.0.0-rc.36', source_revision: revision },
        ''
      )
    ).toEqual({
      label: 'v1.0.0-rc.36',
      revision,
    })
  })
  it('uses the compiled client commit when an older server provides none', () => {
    expect(getBuildVersion({ version: '' }, revision)).toEqual({
      label: 'git.5ce47e8883c5',
      revision,
    })
  })
  it('leaves an unidentified build unknown instead of inventing a release or commit', () => {
    expect(getBuildVersion({ source_revision: 'not-a-commit' }, '')).toEqual({
      label: undefined,
      revision: undefined,
    })
  })
})
