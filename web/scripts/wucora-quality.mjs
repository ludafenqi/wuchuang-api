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
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Compare diagnostics, including duplicate findings, against the exact incoming
// upstream. Existing debt remains visible; changed files must pass independently.
const upstream = process.argv[2]
assert.match(upstream || '', /^[a-f0-9]{40}$/)
const root = path.resolve('..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wucora-quality-'))
const baseline = path.join(scratch, 'baseline')
const output = path.resolve(
  process.env.UI_QUALITY_DIR || '../.local-tests/ui-quality'
)
fs.mkdirSync(baseline)
fs.mkdirSync(output, { recursive: true })
const archive = execFileSync(
  'git',
  ['archive', '--format=tar', upstream, 'web'],
  { cwd: root, maxBuffer: 50 * 1024 * 1024 }
)
const extract = spawnSync('tar', ['-xf', '-', '-C', baseline], {
  input: archive,
})
assert.equal(extract.status, 0, extract.stderr?.toString())
const bin = path.resolve('node_modules/.bin')
const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH }
const lint =
  process.platform === 'win32' ? 'oxlint.exe' : path.join(bin, 'oxlint')
const changed = new Set(
  execFileSync('git', ['diff', upstream, '--name-only', '--', 'web'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(
      (p) =>
        /\.(tsx?|mjs|css|json)$/.test(p) && fs.existsSync(path.join(root, p))
    )
    .map((p) => p.slice(4))
)
const summary = {}
const diagnostics = {}
for (const [kind, cwd] of [
  ['upstream', path.join(baseline, 'web')],
  ['candidate', process.cwd()],
]) {
  const result = spawnSync(
    lint,
    ['-c', '.oxlintrc.json', '--format=json', '.'],
    { cwd, env, encoding: 'utf8', maxBuffer: 10e6 }
  )
  assert.ok(
    result.status === 0 || result.status === 1,
    result.error?.message || result.stderr
  )
  const data = JSON.parse(result.stdout)
  assert.ok(Array.isArray(data.diagnostics))
  diagnostics[kind] = data.diagnostics
  fs.writeFileSync(path.join(output, `${kind}-lint.json`), result.stdout)
  summary[kind] = {
    errors: data.diagnostics.filter((d) => d.severity === 'error').length,
    warnings: data.diagnostics.filter((d) => d.severity === 'warning').length,
  }
}
const signature = (d) =>
  JSON.stringify([
    d.filename.replaceAll('\\', '/'),
    d.code,
    d.severity,
    d.message,
  ])
const baselineCounts = new Map()
for (const d of diagnostics.upstream) {
  baselineCounts.set(signature(d), (baselineCounts.get(signature(d)) || 0) + 1)
}
const added = []
for (const d of diagnostics.candidate) {
  const key = signature(d)
  if (baselineCounts.get(key)) {
    baselineCounts.set(key, baselineCounts.get(key) - 1)
  } else {
    added.push(d)
  }
}
const changedErrors = diagnostics.candidate.filter(
  (d) => d.severity === 'error' && changed.has(d.filename.replaceAll('\\', '/'))
)
const formats = {}
for (const [kind, cwd] of [
  ['upstream', path.join(baseline, 'web')],
  ['candidate', process.cwd()],
]) {
  const result = spawnSync(
    process.execPath,
    ['scripts/format-with-protected-headers.mjs', '--check'],
    { cwd, env, encoding: 'utf8', maxBuffer: 10e6 }
  )
  const text = result.stdout + result.stderr
  fs.writeFileSync(path.join(output, `${kind}-format.log`), text)
  assert.ok(
    result.status === 0 ||
      (result.status === 1 && text.includes('Format issues found')),
    text
  )
  formats[kind] = text
    .split(/\r?\n/)
    .filter((line) => /^(src|scripts)[\\/]/.test(line))
    .map((line) => line.replaceAll('\\', '/'))
}
const newFormats = formats.candidate.filter(
  (file) => !formats.upstream.includes(file) || changed.has(file)
)
const passed =
  added.filter((d) => d.severity === 'error').length === 0 &&
  changedErrors.length === 0 &&
  newFormats.length === 0
fs.writeFileSync(
  path.join(output, 'quality.json'),
  JSON.stringify(
    {
      upstream,
      summary,
      added,
      changedErrors,
      formats,
      newFormats,
      gate: passed ? 'NO_NEW_ERRORS' : 'FAIL',
      fullLint: 'BASELINE_FINDINGS',
      fullFormat: 'BASELINE_FINDINGS',
    },
    null,
    2
  )
)
console.log(
  JSON.stringify({
    summary,
    newErrors: added.filter((d) => d.severity === 'error').length,
    changedErrors: changedErrors.length,
    newFormats,
    gate: passed ? 'NO_NEW_ERRORS' : 'FAIL',
    output,
  })
)
process.exitCode = passed ? 0 : 1
