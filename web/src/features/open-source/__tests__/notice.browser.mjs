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

// Run against a disposable local installation with existing root/user fixtures.
// This verifies the real settings API and restores the original footer option.
export async function assertHomeNoticeConfiguration(props) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(props.origin).hostname))
  const admin = await props.browser.newContext()
  const reader = await props.browser.newContext()
  const user = await props.browser.newContext()
  for (const context of [admin, reader, user]) {
    await context.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
  }
  const login = await admin.request.post(`${props.origin}/api/user/login`, {
    data: props.rootCredentials,
  })
  const rootIdentity = await login.json()
  assert.ok(rootIdentity.success, 'The root fixture must sign in')
  await admin.setExtraHTTPHeaders({
    Authorization: `Bearer ${rootIdentity.data.access_token}`,
  })
  const originalOptions = await admin.request
    .get(`${props.origin}/api/option/`)
    .then((response) => response.json())
  assert.ok(originalOptions.success)
  const original = Object.fromEntries(
    originalOptions.data.map((option) => [option.key, option.value])
  )
  const settings = await admin.newPage()
  const home = await reader.newPage()
  let lastPayload
  const results = []
  try {
    // Keep an existing public tab open to verify a fresh fetch when opening.
    await home.goto(props.origin)
    await home.locator('.wucora-home-footer a[href="/open-source"]').waitFor()
    assert.equal(
      await home
        .locator(
          '.wucora-home-footer a[href="https://github.com/QuantumNous/new-api"]'
        )
        .count(),
      0
    )
    assert.equal(
      await home
        .getByText('New API Project Repository:', { exact: true })
        .count(),
      0
    )
    assert.equal(await home.locator('.wucora-home-attribution').count(), 0)

    await settings.goto(`${props.origin}/system-settings/site/footer`)
    const editor = settings.getByLabel('Home open-source notice', {
      exact: true,
    })
    await editor.waitFor()
    const content =
      '## Local notice regression\nFirst paragraph\n\n[Corresponding source](https://example.com/source)\n[License](https://example.com/license)'
    await editor.fill(content)
    let saved = settings.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/option/footer' &&
        response.request().method() === 'PUT'
    )
    await settings
      .getByRole('button', { name: 'Save Changes', exact: true })
      .last()
      .click()
    const response = await saved
    assert.ok((await response.json()).success)
    lastPayload = response.request().postDataJSON()
    assert.equal(JSON.parse(lastPayload.FooterConfig).openSourceNotice, content)
    await settings.reload()
    await editor.waitFor()
    assert.equal(await editor.inputValue(), content)
    const readback = await admin.request
      .get(`${props.origin}/api/option/`)
      .then((response) => response.json())
    assert.equal(
      JSON.parse(
        readback.data.find((option) => option.key === 'FooterConfig').value
      ).openSourceNotice,
      content
    )
    await home.locator('.wucora-home-footer a[href="/open-source"]').click()
    const dialog = home.getByRole('dialog', {
      name: 'Open-source notice',
      exact: true,
    })
    await dialog
      .getByRole('heading', { name: 'Local notice regression' })
      .waitFor()
    assert.equal(
      await dialog
        .getByRole('link', { name: 'Corresponding source' })
        .getAttribute('href'),
      'https://example.com/source'
    )
    await settings.screenshot({
      path: `${props.outputDirectory}/notice-settings.png`,
      fullPage: true,
    })
    await home.screenshot({
      path: `${props.outputDirectory}/notice-configured.png`,
    })
    results.push({
      saveAndReload: true,
      settingsReadback: true,
      existingPublicTabRefreshOnOpen: true,
    })

    const ordinaryLogin = await user.request.post(
      `${props.origin}/api/user/login`,
      { data: props.userCredentials }
    )
    const ordinaryIdentity = await ordinaryLogin.json()
    assert.ok(ordinaryIdentity.success)
    assert.equal(ordinaryIdentity.data.user.role, 1)
    await user.setExtraHTTPHeaders({
      Authorization: `Bearer ${ordinaryIdentity.data.access_token}`,
    })
    const deniedBatch = await user.request.put(
      `${props.origin}/api/option/footer`,
      {
        data: {
          ...lastPayload,
          FooterConfig: lastPayload.FooterConfig.replace(
            'First paragraph',
            'Unauthorized edit'
          ),
        },
      }
    )
    const deniedSingle = await user.request.put(`${props.origin}/api/option/`, {
      data: {
        key: 'FooterConfig',
        value: lastPayload.FooterConfig.replace(
          'First paragraph',
          'Unauthorized edit'
        ),
      },
    })
    const deniedAnonymous = await reader.request.put(
      `${props.origin}/api/option/footer`,
      { data: lastPayload }
    )
    assert.equal(deniedBatch.status(), 403)
    assert.equal(deniedSingle.status(), 403)
    assert.equal(deniedAnonymous.status(), 401)
    const publicStatus = await user.request
      .get(`${props.origin}/api/status`)
      .then((response) => response.json())
    assert.equal(
      JSON.parse(publicStatus.data.footer_config).openSourceNotice,
      content
    )
    results.push({
      ordinaryUserWriteStatuses: [deniedBatch.status(), deniedSingle.status()],
      anonymousWriteStatus: deniedAnonymous.status(),
      publicReadUnchanged: true,
    })

    const payload =
      '<script>window.__noticeXss=1</script><img src=x onerror="window.__noticeXss=2"><iframe srcdoc="<script>alert(1)</script>"></iframe>\n\n<a href="javascript:alert(1)">JavaScript</a> <a href="java&#x09;script:alert(1)">Obfuscated</a> <a href="data:text/html,test">Data</a> <a href="file:///etc/passwd">File</a> [Safe source](https://example.com/source)'
    await editor.fill(payload)
    saved = settings.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/option/footer' &&
        response.request().method() === 'PUT'
    )
    await settings
      .getByRole('button', { name: 'Save Changes', exact: true })
      .last()
      .click()
    assert.ok((await (await saved).json()).success)
    const alerts = []
    home.on('dialog', async (event) => {
      alerts.push(event.type())
      await event.dismiss()
    })
    await home.reload()
    await dialog.getByRole('link', { name: 'Safe source' }).waitFor()
    assert.equal(
      await dialog
        .locator('script, iframe, [onerror], [onload], [srcdoc]')
        .count(),
      0
    )
    for (const name of ['JavaScript', 'Obfuscated', 'Data', 'File']) {
      assert.equal(
        await dialog.getByText(name, { exact: true }).getAttribute('href'),
        null
      )
    }
    assert.equal(await home.evaluate(() => window.__noticeXss), undefined)
    assert.deepEqual(alerts, [])
    results.push({
      scriptsRemoved: true,
      eventHandlersRemoved: true,
      unsafeLinksInert: true,
      codeExecuted: false,
    })

    await editor.fill('')
    saved = settings.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/option/footer' &&
        response.request().method() === 'PUT'
    )
    await settings
      .getByRole('button', { name: 'Save Changes', exact: true })
      .last()
      .click()
    assert.ok((await (await saved).json()).success)
    await home.reload()
    await dialog
      .getByText('No open-source notice configured', { exact: true })
      .waitFor()
    assert.equal(await dialog.locator('a').count(), 0)
    assert.equal(
      await home
        .locator('a[href="https://github.com/QuantumNous/new-api"]')
        .count(),
      0
    )
    await home.screenshot({ path: `${props.outputDirectory}/notice-empty.png` })
    results.push({ emptyPersists: true, noLegacyFallback: true })
    return results
  } finally {
    const restored = await admin.request.put(
      `${props.origin}/api/option/footer`,
      {
        data: {
          SystemName: original.SystemName,
          FooterConfig: original.FooterConfig ?? '',
        },
      }
    )
    assert.ok(
      (await restored.json()).success,
      'The original local footer configuration must be restored'
    )
    await Promise.all([admin.close(), reader.close(), user.close()])
  }
}
