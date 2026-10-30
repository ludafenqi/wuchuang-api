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
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

import { PasswordInput } from '../password-input'

const resources = { en, zh, 'zh-TW': zhTW, fr, ja, ru, vi: viLocale }
const names = [
  ['en', 'Show password', 'Hide password'],
  ['zh', '显示密码', '隐藏密码'],
  ['zh-TW', '顯示密碼', '隱藏密碼'],
  ['fr', 'Afficher le mot de passe', 'Masquer le mot de passe'],
  ['ja', 'パスワードを表示', 'パスワードを非表示'],
  ['ru', 'Показать пароль', 'Скрыть пароль'],
  ['vi', 'Hiện mật khẩu', 'Ẩn mật khẩu'],
] as const

it.each(names)(
  'announces the visibility action in %s while preserving input and submission',
  async (language, show, hide) => {
    const i18n = createInstance()
    await i18n
      .use(initReactI18next)
      .init({ lng: language, fallbackLng: false, resources })
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <I18nextProvider i18n={i18n}>
        <form onSubmit={onSubmit}>
          <PasswordInput
            name='password'
            aria-label='Password'
            autoComplete='current-password'
          />
        </form>
      </I18nextProvider>
    )
    const user = userEvent.setup()
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
    await user.click(input)
    await user.paste('local-preview-value-only')
    await user.click(screen.getByRole('button', { name: show }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('local-preview-value-only')
    expect(screen.getByRole('button', { name: hide })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('local-preview-value-only')
    expect(screen.getByRole('button', { name: show })).toBeEnabled()
    expect(onSubmit).not.toHaveBeenCalled()
  }
)

it('updates the accessible action when the interface language changes', async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', resources })
  render(
    <I18nextProvider i18n={i18n}>
      <PasswordInput aria-label='Password' />
    </I18nextProvider>
  )
  expect(screen.getByRole('button', { name: 'Show password' })).toBeVisible()
  await act(() => i18n.changeLanguage('zh'))
  expect(screen.getByRole('button', { name: '显示密码' })).toBeVisible()
})

it('keeps both the password field and visibility action disabled', async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', resources })
  render(
    <I18nextProvider i18n={i18n}>
      <PasswordInput
        aria-label='Password'
        disabled
        defaultValue='local-preview-value-only'
      />
    </I18nextProvider>
  )
  expect(screen.getByLabelText('Password')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
})
