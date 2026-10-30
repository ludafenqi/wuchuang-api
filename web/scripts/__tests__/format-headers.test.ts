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
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

const fixtures: string[] = []
afterEach(() => {
  for (const fixture of fixtures) {
    expect(path.resolve(path.dirname(fixture))).toBe(path.resolve(os.tmpdir()))
    fs.rmSync(fixture, { recursive: true, force: true })
  }
  fixtures.length = 0
})

it.each(['\n', '\r\n'])(
  'preserves the exact copyright bytes with %j line endings',
  (newline) => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wucora-format-test-')
    )
    fixtures.push(fixture)
    const script = path.resolve('scripts/format-with-protected-headers.mjs')
    const original = fs
      .readFileSync(script, 'utf8')
      .match(/^\/\*[\s\S]*?\*\//)?.[0]
    if (!original) throw new Error('The formatter license header is missing')
    const header =
      original.replaceAll('\r\n', '\n').replaceAll('\n', newline) + newline
    const file = path.join(fixture, 'fixture.ts')
    fs.writeFileSync(file, `${header}export const value={a:1};\n`)
    fs.writeFileSync(
      path.join(fixture, '.oxfmtrc.json'),
      '{"semi":false,"singleQuote":true}'
    )
    fs.writeFileSync(path.join(fixture, '.gitignore'), '')
    const write = spawnSync(process.execPath, [script, '--write'], {
      cwd: fixture,
      encoding: 'utf8',
    })
    expect(write.status, write.stdout + write.stderr).toBe(0)
    const formatted = fs.readFileSync(file)
    expect(formatted.subarray(0, Buffer.byteLength(header))).toEqual(
      Buffer.from(header)
    )
    expect(formatted.toString().slice(header.length)).toContain(
      'export const value = { a: 1 }'
    )
    const check = spawnSync(process.execPath, [script, '--check'], {
      cwd: fixture,
      encoding: 'utf8',
    })
    expect(check.status, check.stdout + check.stderr).toBe(0)
    expect(fs.readFileSync(file)).toEqual(formatted)
  }
)
