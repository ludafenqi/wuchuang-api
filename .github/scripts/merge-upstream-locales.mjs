/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const languages = ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']

export function parseLocale(source) {
  const json = JSON.parse(source)
  assert.deepEqual(Object.keys(json), ['translation'], 'Unexpected locale envelope')
  assert.ok(json.translation && !Array.isArray(json.translation))
  assert.equal(typeof json.translation, 'object')
  assert.ok(Object.values(json.translation).every(value => typeof value === 'string'))
  // JSON.parse accepts duplicate names. Reject them, including escaped aliases,
  // before using a parsed object as proof of a lossless three-way merge.
  const objects = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') objects.push(new Set())
    else if (source[i] === '}') objects.pop()
    else if (source[i] === '"') {
      const start = i++
      while (source[i] !== '"') {
        if (source[i] === '\\') i++
        i++
      }
      let next = i + 1
      while (/\s/.test(source[next] || '') && next < source.length) next++
      if (source[next] === ':') {
        const key = JSON.parse(source.slice(start, i + 1))
        assert.ok(!objects.at(-1).has(key), 'Duplicate locale key: ' + key)
        objects.at(-1).add(key)
      }
    }
  }
  return json.translation
}

export function mergeTranslations(base, ours, theirs) {
  const missing = Symbol('absent translation')
  const value = (object, key) => Object.hasOwn(object, key) ? object[key] : missing
  const entries = [], conflicts = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const before = value(base, key), local = value(ours, key), upstream = value(theirs, key)
    let merged
    if (local === upstream) merged = local
    else if (local === before) merged = upstream
    else if (upstream === before) merged = local
    else {
      conflicts.push(key)
      continue
    }
    if (merged !== missing) entries.push([key, merged])
  }
  assert.equal(conflicts.length, 0, 'Semantic locale conflicts: ' + conflicts.join(', '))
  return Object.fromEntries(entries)
}

// This function becomes the temporary sanctioned add-missing-keys.mjs entrypoint.
// Its newKeys are complete proved results, not guessed translations. Starting
// empty also preserves proved deletions while conflict markers are on disk.
async function applyLocaleProposals(newKeys) {
  const LOCALES_DIR = path.resolve('src/i18n/locales')
  function stableStringify(obj) {
    return JSON.stringify(obj, null, 2) + '\n'
  }
  let totalAdded = 0
  for (const [locale, trans] of Object.entries(newKeys)) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`)
    const json = { translation: Object.fromEntries([]) }
    let count = 0
    for (const [key, value] of Object.entries(trans)) {
      if (!Object.prototype.hasOwnProperty.call(json.translation, key) || json.translation[key] !== value) {
        Object.defineProperty(json.translation, key, { value, enumerable: true, writable: true, configurable: true })
        count++
      }
    }
    json.translation = Object.fromEntries(Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b)))
    await fs.writeFile(filePath, stableStringify(json), 'utf8')
    console.log(`${locale}: ${count} proved translations applied`)
    totalAdded += count
  }
  console.log(`Total: ${totalAdded} proved translations applied`)
}

export function resolveLocaleConflicts(root, bun = 'bun') {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const conflicts = git(['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean)
  assert.ok(conflicts.length > 0, 'No merge conflicts to resolve')
  const supported = new Set(languages.map(lang => `web/src/i18n/locales/${lang}.json`))
  assert.ok(conflicts.every(file => supported.has(file)), 'Non-locale merge conflict; resolve manually')
  const expected = {}, proposals = {}
  // Preflight every file and every key before writing or staging any locale.
  for (const lang of languages) {
    const file = `web/src/i18n/locales/${lang}.json`
    if (conflicts.includes(file)) {
      const [base, ours, theirs] = [1, 2, 3].map(stage => parseLocale(git(['show', `:${stage}:${file}`])))
      expected[lang] = mergeTranslations(base, ours, theirs)
      proposals[lang] = expected[lang]
    } else {
      expected[lang] = parseLocale(git(['show', ':' + file]))
      assert.deepEqual(parseLocale(fs.readFileSync(path.join(root, file), 'utf8')), expected[lang], 'Unstaged locale changes: ' + lang)
    }
  }
  const writer = path.join(root, 'web/scripts/add-missing-keys.mjs')
  const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'wucora-locale-merge-'))
  const payload = path.join(temporary, 'proposals.json')
  let ownsWriter = false
  try {
    fs.writeFileSync(payload, JSON.stringify(proposals))
    fs.writeFileSync(writer, "import fs from 'node:fs/promises'\nimport path from 'node:path'\n" + applyLocaleProposals.toString() + "\nawait applyLocaleProposals(JSON.parse(await fs.readFile(process.argv[2], 'utf8')))\n", { flag: 'wx' })
    ownsWriter = true
    execFileSync(process.execPath, [writer, payload], { cwd: path.join(root, 'web'), stdio: 'inherit' })
    execFileSync(bun, ['run', 'i18n:sync'], { cwd: path.join(root, 'web'), stdio: 'inherit' })
    // Normalization may reorder/escape names, but may not add, delete, or alter
    // any proved value, even in an otherwise unconflicted language.
    for (const lang of languages) {
      assert.deepEqual(parseLocale(fs.readFileSync(path.join(root, `web/src/i18n/locales/${lang}.json`), 'utf8')), expected[lang], 'i18n normalization changed meaning: ' + lang)
    }
    git(['add', '--', ...supported])
    assert.equal(git(['diff', '--name-only', '--diff-filter=U']).trim(), '')
    return conflicts
  } finally {
    if (ownsWriter) fs.unlinkSync(writer)
    fs.rmSync(payload, { force: true })
    fs.rmdirSync(temporary)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log('Resolved locale files:', resolveLocaleConflicts(process.cwd(), process.env.BUN_BINARY || 'bun'))
}
