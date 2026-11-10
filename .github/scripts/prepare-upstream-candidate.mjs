/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizeLocales } from './merge-upstream-locales.mjs'

// Fetching is confined to the entry point. This function also runs against real
// local repositories in tests, including the failed merge and abort paths.
export function prepareCandidate({
  root,
  upstream,
  resolved = '',
  resolveLocales,
}) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const ancestor = (older, newer) =>
    git(['merge-base', '--is-ancestor', older, newer])
  assert.match(upstream, /^[0-9a-f]{40}$/)
  if (resolved) assert.match(resolved, /^[0-9a-f]{40}$/)
  assert.equal(
    git(['status', '--porcelain', '--untracked-files=no']),
    '',
    'Tracked checkout must be clean'
  )
  const base = git(['rev-parse', 'origin/main'])
  ancestor(upstream, 'upstream/main')
  const pinAt = (ref) =>
    JSON.parse(git(['show', `${ref}:.github/wucora-ui.json`]))
  const basePin = pinAt(base)
  if (resolved) {
    ancestor(base, resolved)
    ancestor(upstream, resolved)
    assert.equal(
      git(['merge-base', resolved, 'upstream/main']),
      upstream,
      'Resolution includes a different upstream batch'
    )
    const { integratedUpstream, ...resolvedUI } = pinAt(resolved)
    const { integratedUpstream: previousUpstream, ...baseUI } = basePin
    assert.equal(
      integratedUpstream,
      upstream,
      'Resolution upstream pin differs'
    )
    assert.deepEqual(
      resolvedUI,
      baseUI,
      'Resolution changes protected UI reference or review policy'
    )
  }
  if (git(['merge-base', base, upstream]) === upstream) {
    if (resolved) {
      git(['checkout', '-B', 'automation/upstream-sync', resolved])
      return {
        changed: resolved !== base,
        base,
        upstream,
        candidate: resolved,
        conflicts: [],
        explicitResolution: resolved,
      }
    }
    return { changed: false, base, upstream, candidate: base, conflicts: [] }
  }

  git(['checkout', '-B', 'automation/upstream-sync', base])
  let conflicts = []
  try {
    git(['merge', '--no-ff', '--no-commit', upstream])
  } catch (mergeError) {
    conflicts = git(['diff', '--name-only', '--diff-filter=U'])
      .split('\n')
      .filter(Boolean)
    assert.ok(conflicts.length, 'Merge failed without resolvable conflicts')
    console.log('Actual merge conflicts:', conflicts.join(', '))
    try {
      resolveLocales()
      assert.equal(git(['diff', '--name-only', '--diff-filter=U']), '')
    } catch (resolutionError) {
      git(['merge', '--abort'])
      if (!resolved)
        throw new Error(
          'Unresolved semantic or non-locale conflict; explicit resolution required',
          { cause: resolutionError }
        )
    }
  }
  if (resolved) {
    // Only an explicit workflow_dispatch input can select this path. Scheduled
    // runs never reuse a previous automation branch as a silent conflict fix.
    if (
      fs.existsSync(
        path.resolve(root, git(['rev-parse', '--git-path', 'MERGE_HEAD']))
      )
    )
      git(['merge', '--abort'])
    git(['checkout', '-B', 'automation/upstream-sync', resolved])
  } else {
    try {
      normalizeLocales(root)
      git(['commit', '--no-edit'])
    } catch (normalizationError) {
      git(['merge', '--abort'])
      throw new Error('Candidate normalization failed; merge aborted', {
        cause: normalizationError,
      })
    }
    const file = path.join(root, '.github/wucora-ui.json')
    fs.writeFileSync(
      file,
      JSON.stringify({ ...basePin, integratedUpstream: upstream }, null, 2) +
        '\n'
    )
    git(['add', '.github/wucora-ui.json'])
    if (git(['diff', '--cached', '--name-only']))
      git(['commit', '-m', 'chore: record pinned upstream candidate'])
  }
  return {
    changed: true,
    base,
    upstream,
    candidate: git(['rev-parse', 'HEAD']),
    conflicts,
    explicitResolution: resolved || null,
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const root = process.cwd()
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  const requested = process.env.REQUESTED_UPSTREAM || ''
  const resolved = process.env.RESOLVED_CANDIDATE || ''
  assert.ok(
    manual || (!requested && !resolved),
    'Pinned/resolved inputs are manual-only'
  )
  if (requested) assert.match(requested, /^[0-9a-f]{40}$/)
  if (resolved) {
    assert.ok(
      requested,
      'An explicit resolution requires an explicit upstream pin'
    )
    assert.match(resolved, /^[0-9a-f]{40}$/)
  }
  const upstreamURL = 'https://github.com/QuantumNous/new-api.git'
  if (git(['remote']).split('\n').includes('upstream'))
    assert.equal(git(['remote', 'get-url', 'upstream']), upstreamURL)
  else git(['remote', 'add', 'upstream', upstreamURL])
  git(['fetch', '--no-tags', 'upstream', 'main'])
  git(['fetch', '--no-tags', 'origin', 'main'])
  const upstream = requested || git(['rev-parse', 'upstream/main'])
  if (resolved) git(['fetch', '--no-tags', 'origin', resolved])
  fs.writeFileSync(
    'upstream-web-changes.txt',
    git(['diff', '--name-only', `origin/main...${upstream}`, '--', 'web']) +
      '\n'
  )
  const result = prepareCandidate({
    root,
    upstream,
    resolved,
    resolveLocales: () =>
      execFileSync(
        process.execPath,
        ['.github/scripts/merge-upstream-locales.mjs'],
        {
          cwd: root,
          stdio: 'inherit',
        }
      ),
  })
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `upstream=${upstream}\nchanged=${result.changed}\ncandidate=${result.candidate}\n`
  )
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    'Upstream preparation evidence:\n```json\n' +
      JSON.stringify(result, null, 2) +
      '\n```\n'
  )
}
