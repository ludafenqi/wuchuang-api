/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { prepareCandidate } from './prepare-upstream-candidate.mjs'

function repository(t, conflict = true) {
  const parent = fs.realpathSync(os.tmpdir())
  const root = fs.mkdtempSync(path.join(parent, 'wucora-prepare-test-'))
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent)
    fs.rmSync(root, { recursive: true, force: true })
  })
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text)
  const commit = (message) => {
    git(['add', '.'])
    git(['commit', '-m', message])
    return git(['rev-parse', 'HEAD'])
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  fs.mkdirSync(path.join(root, '.github'))
  const pin = {
    uiReference: 'a'.repeat(40),
    integratedUpstream: 'b'.repeat(40),
    reviewRequired: true,
  }
  write('.github/wucora-ui.json', JSON.stringify(pin) + '\n')
  write('behavior.txt', 'original\n')
  const common = commit('shared base')
  write('behavior.txt', 'fork behavior\n')
  const base = commit('fork change')
  git(['update-ref', 'refs/remotes/origin/main', base])
  git(['checkout', '-b', 'upstream-tip', common])
  write(conflict ? 'behavior.txt' : 'upstream.txt', 'upstream behavior\n')
  const upstream = commit('upstream change')
  git(['update-ref', 'refs/remotes/upstream/main', upstream])
  git(['checkout', '-b', 'prepared', base])
  try {
    git(['merge', '--no-ff', '--no-edit', upstream])
  } catch {
    write('behavior.txt', 'fork behavior\nupstream behavior\n')
  }
  write(
    '.github/wucora-ui.json',
    JSON.stringify({ ...pin, integratedUpstream: upstream }) + '\n'
  )
  const resolved = commit('explicit reviewed resolution')
  git(['checkout', 'main'])
  return { root, git, write, commit, base, upstream, resolved, pin }
}

test('a clean merge includes both histories and records its exact upstream', (t) => {
  const f = repository(t, false)
  const result = prepareCandidate({
    ...f,
    resolved: '',
    resolveLocales: () => assert.fail('No conflict expected'),
  })
  assert.equal(result.changed, true)
  assert.equal(f.git(['show', 'HEAD:behavior.txt']), 'fork behavior')
  assert.equal(f.git(['show', 'HEAD:upstream.txt']), 'upstream behavior')
  assert.equal(
    JSON.parse(f.git(['show', 'HEAD:.github/wucora-ui.json']))
      .integratedUpstream,
    f.upstream
  )
  assert.equal(f.git(['rev-parse', 'main']), f.base)
})

test('unresolved non-locale conflicts abort without changing main or the index', (t) => {
  const f = repository(t)
  assert.throws(
    () =>
      prepareCandidate({
        ...f,
        resolved: '',
        resolveLocales: () => {
          throw Error('Non-locale conflict')
        },
      }),
    /explicit resolution required/
  )
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base)
  assert.equal(f.git(['status', '--porcelain']), '')
  assert.equal(f.git(['rev-parse', 'main']), f.base)
})

test('an explicitly pinned resolution follows an actual failed merge and keeps both changes', (t) => {
  const f = repository(t)
  const result = prepareCandidate({
    ...f,
    resolveLocales: () => {
      throw Error('Non-locale conflict')
    },
  })
  assert.deepEqual(result.conflicts, ['behavior.txt'])
  assert.equal(result.candidate, f.resolved)
  assert.equal(
    f.git(['show', 'HEAD:behavior.txt']),
    'fork behavior\nupstream behavior'
  )
  assert.equal(f.git(['status', '--porcelain']), '')
  assert.equal(f.git(['rev-parse', 'main']), f.base)
})

test('a resolution with a changed UI policy or stale pin is rejected before checkout', (t) => {
  for (const change of [
    { reviewRequired: false },
    { integratedUpstream: 'c'.repeat(40) },
  ]) {
    const f = repository(t)
    f.git(['checkout', 'prepared'])
    f.write(
      '.github/wucora-ui.json',
      JSON.stringify({ ...f.pin, integratedUpstream: f.upstream, ...change }) +
        '\n'
    )
    const resolved = f.commit('invalid resolution metadata')
    f.git(['checkout', 'main'])
    assert.throws(
      () => prepareCandidate({ ...f, resolved }),
      /policy|pin differs/
    )
    assert.equal(f.git(['rev-parse', 'HEAD']), f.base)
  }
})

test('a candidate missing fork ancestry and malformed inputs cannot be selected', (t) => {
  const f = repository(t)
  assert.throws(() => prepareCandidate({ ...f, resolved: f.upstream }))
  assert.throws(() => prepareCandidate({ ...f, upstream: '--all' }))
  assert.throws(() => prepareCandidate({ ...f, resolved: 'prepared' }))
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base)
})
