/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mergeTranslations, parseLocale, resolveLocaleConflicts } from './merge-upstream-locales.mjs'

test('three-way values retain disjoint additions, changes, deletions and fork keys', () => {
  const result = mergeTranslations(
    { edit: 'old', remove: 'old', localEdit: 'old', common: 'old', localRemove: 'old' },
    { edit: 'old', remove: 'old', localEdit: 'local', common: 'same', local: 'WuCora' },
    { edit: 'new', localEdit: 'old', common: 'same', localRemove: 'old', upstream: 'Vertex' },
  )
  assert.deepEqual(result, { edit: 'new', localEdit: 'local', common: 'same', local: 'WuCora', upstream: 'Vertex' })
})

test('different same-key edits and delete-versus-edit stop for manual review', () => {
  for (const [base, ours, theirs] of [
    [{ key: 'old' }, { key: 'local' }, { key: 'upstream' }],
    [{ key: 'old' }, {}, { key: 'upstream' }],
    [{ key: 'old' }, { key: 'local' }, {}],
    [{}, { key: 'local' }, { key: 'upstream' }],
  ]) assert.throws(() => mergeTranslations(base, ours, theirs), /Semantic locale conflicts: key/)
})

test('locale parsing rejects ambiguous JSON and preserves literal prototype names', () => {
  for (const source of [
    '{"translation":{"x":"first","x":"second"}}',
    '{"translation":{"x":"first","\\u0078":"second"}}',
    '{"translation":{},"translation":{}}',
    '{"translation":{"x":null}}',
    '{"translation":{},"other":{}}',
  ]) assert.throws(() => parseLocale(source))
  const parsed = parseLocale('{"translation":{"__proto__":"literal","quoted":"a \\\"key\\\": value"}}')
  assert.equal(parsed.__proto__, 'literal')
  assert.equal(Object.hasOwn(mergeTranslations({}, parsed, {}), '__proto__'), true)
})

function mergeFixture(t, semanticConflict = false, otherConflict = false) {
  const parent = fs.realpathSync(os.tmpdir())
  const root = fs.mkdtempSync(path.join(parent, 'wucora-locales-test-'))
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent)
    fs.rmSync(root, { recursive: true, force: true })
  })
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }
  const git = args => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  fs.mkdirSync(path.join(root, 'web/src/i18n/locales'), { recursive: true })
  fs.mkdirSync(path.join(root, 'web/scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'web/package.json'), '{"scripts":{"i18n:sync":"node scripts/sync-i18n.mjs"}}')
  fs.writeFileSync(path.join(root, 'web/scripts/sync-i18n.mjs'), '// Fixture normalization preserves already sorted values.\n')
  const write = values => {
    for (const lang of ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']) fs.writeFileSync(path.join(root, `web/src/i18n/locales/${lang}.json`), JSON.stringify({ translation: values }, null, 2) + '\n')
  }
  git(['init', '-b', 'main'])
  write({ A: 'same', Z: 'same' })
  fs.writeFileSync(path.join(root, 'other.txt'), 'base\n')
  git(['add', '.']); git(['commit', '-m', 'base'])
  git(['checkout', '-b', 'upstream'])
  write({ A: 'same', Upstream: 'Vertex', Z: 'same' })
  if (otherConflict) fs.writeFileSync(path.join(root, 'other.txt'), 'upstream\n')
  git(['add', '.']); git(['commit', '-m', 'upstream'])
  git(['checkout', 'main'])
  write(semanticConflict ? { A: 'same', Upstream: 'Different', Z: 'same' } : { A: 'same', Local: 'WuCora', Z: 'same' })
  if (otherConflict) fs.writeFileSync(path.join(root, 'other.txt'), 'local\n')
  git(['add', '.']); git(['commit', '-m', 'local'])
  assert.throws(() => git(['merge', '--no-commit', '--no-ff', 'upstream']))
  return { root, git }
}

test('real adjacent Git conflicts resolve all seven languages through the sanctioned writer', t => {
  const { root, git } = mergeFixture(t)
  assert.equal(resolveLocaleConflicts(root, process.env.BUN_BINARY || 'bun').length, 7)
  assert.equal(git(['diff', '--name-only', '--diff-filter=U']), '')
  const locale = parseLocale(fs.readFileSync(path.join(root, 'web/src/i18n/locales/en.json'), 'utf8'))
  assert.deepEqual(locale, { A: 'same', Local: 'WuCora', Upstream: 'Vertex', Z: 'same' })
  assert.equal(fs.existsSync(path.join(root, 'web/scripts/add-missing-keys.mjs')), false)
})

test('semantic or non-locale conflicts leave every file and index unchanged', t => {
  for (const [semantic, other] of [[true, false], [false, true]]) {
    const { root, git } = mergeFixture(t, semantic, other)
    const beforeIndex = git(['ls-files', '-u'])
    const file = path.join(root, 'web/src/i18n/locales/en.json')
    const before = fs.readFileSync(file, 'utf8')
    assert.throws(() => resolveLocaleConflicts(root), /Semantic locale conflicts|Non-locale merge conflict/)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.equal(git(['ls-files', '-u']), beforeIndex)
    assert.equal(fs.existsSync(path.join(root, 'web/scripts/add-missing-keys.mjs')), false)
  }
})

test('a normalizer semantic change cannot stage a candidate and merge abort restores locales', t => {
  const { root, git } = mergeFixture(t)
  const file = 'web/src/i18n/locales/en.json'
  const ours = git(['show', 'HEAD:' + file])
  fs.writeFileSync(path.join(root, 'web/scripts/sync-i18n.mjs'), "import fs from 'node:fs'; const p='src/i18n/locales/en.json';const json=JSON.parse(fs.readFileSync(p));json.translation.Upstream='unexpected';fs.writeFileSync(p,JSON.stringify(json));\n")
  const beforeIndex = git(['ls-files', '-u'])
  assert.throws(() => resolveLocaleConflicts(root, process.env.BUN_BINARY || 'bun'), /normalization changed meaning/)
  assert.equal(git(['ls-files', '-u']), beforeIndex)
  assert.equal(fs.existsSync(path.join(root, 'web/scripts/add-missing-keys.mjs')), false)
  git(['merge', '--abort'])
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8').trim().replaceAll('\r\n', '\n'), ours.replaceAll('\r\n', '\n'))
})
