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
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  defaultFooterConfig,
  footerConfigSchema,
  parseFooterConfig,
} from '@/features/footer/config'
import { DEFAULT_SYSTEM_NAME } from '@/lib/constants'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import type { SiteSettings } from '../types'
import { FooterLinkEditor } from './link-editor'
import { FooterPreview } from './preview'

const formSchema = z.object({
  SystemName: z.string().trim().min(1).max(100),
  config: footerConfigSchema,
})
export type FooterFormValues = z.infer<typeof formSchema>

export function FooterManagement(props: { settings: SiteSettings }) {
  const { t } = useTranslation()
  const update = useUpdateOption()
  const [confirmReset, setConfirmReset] = useState(false)
  const form = useForm<FooterFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      SystemName:
        props.settings.SystemName === DEFAULT_SYSTEM_NAME
          ? '晤创AI'
          : props.settings.SystemName,
      config: parseFooterConfig(props.settings.FooterConfig),
    },
  })
  const values = useWatch({ control: form.control }) as FooterFormValues
  const save = form.handleSubmit(async (data) => {
    try {
      if (data.SystemName !== props.settings.SystemName) {
        await update.mutateAsync({ key: 'SystemName', value: data.SystemName })
      }
      await update.mutateAsync({
        key: 'FooterConfig',
        value: JSON.stringify(data.config),
      })
      form.reset(data)
    } catch {
      /* The shared mutation reports the error; keep the unsaved draft. */
    }
  })
  return (
    <>
      <FormNavigationGuard when={form.formState.isDirty} />
      <SettingsSection title={t('Footer management')}>
        <Form {...form}>
          <SettingsForm onSubmit={save}>
            <SettingsPageFormActions
              onSave={save}
              onReset={() => form.reset()}
              isSaving={update.isPending}
            />
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='SystemName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Brand name')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={100} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Uses the existing site name and logo. Updating the brand name also updates the site name.'
                )}
              </p>
              <FormField
                control={form.control}
                name='config.description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Brand description')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} maxLength={500} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='config.copyright'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Copyright text')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={200} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='config.year'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Custom year')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder='2023-2026'
                        disabled={values.config.autoYear}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {(['enabled', 'autoYear'] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={`config.${name}`}
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between gap-4'>
                      <FormLabel>
                        {t(
                          name === 'enabled'
                            ? 'Show footer'
                            : 'Automatic copyright year'
                        )}
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              ))}
              {(
                [
                  {
                    name: 'layout',
                    label: 'Footer layout',
                    options: [
                      ['brand', 'Brand focused'],
                      ['developer', 'Developer platform'],
                      ['minimal', 'Minimal'],
                    ],
                  },
                  {
                    name: 'background',
                    label: 'Footer background',
                    options: [
                      ['theme', 'Follow theme'],
                      ['muted', 'Muted'],
                      ['accent', 'Accent'],
                    ],
                  },
                  {
                    name: 'legacyMode',
                    label: 'Legacy custom HTML',
                    options: [
                      ['replace', 'Use custom HTML'],
                      ['append', 'Append custom HTML'],
                      ['ignore', 'Use visual footer'],
                    ],
                  },
                ] as const
              ).map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={`config.${item.name}`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(item.label)}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className='w-full'>
                            <SelectValue>
                              {t(
                                item.options.find(
                                  ([value]) => value === field.value
                                )?.[1] ?? ''
                              )}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {item.options.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {t(label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </SettingsFormGrid>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Existing custom HTML is preserved in System Information. Switch to the visual footer to activate the selected template without deleting that content.'
              )}
            </p>
            <FooterLinkEditor form={form} />
            {!form.formState.isValid && form.formState.isSubmitted && (
              <p role='alert' className='text-destructive'>
                {t('Invalid footer configuration')}
              </p>
            )}
            <div className='flex flex-wrap gap-2'>
              <Button type='submit' disabled={update.isPending}>
                {t('Save Changes')}
              </Button>
              <Button
                type='button'
                variant='outline'
                onClick={() => setConfirmReset(true)}
                disabled={update.isPending}
              >
                {t('Restore defaults')}
              </Button>
            </div>
            <FooterPreview
              config={values.config}
              name={values.SystemName}
              logo={props.settings.Logo}
              legacyHtml={props.settings.Footer}
              availability={{
                docsLink: props.settings['general_setting.docs_link'],
                agreementEnabled: !!props.settings['legal.user_agreement'],
                privacyEnabled: !!props.settings['legal.privacy_policy'],
              }}
            />
          </SettingsForm>
        </Form>
      </SettingsSection>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('Restore defaults')}
        desc={t(
          'Restore the visual footer defaults in this draft. The site name, logo and custom HTML are preserved. Save to apply.'
        )}
        handleConfirm={() => {
          form.setValue(
            'config',
            { ...defaultFooterConfig(), legacyMode: 'ignore' },
            { shouldDirty: true, shouldValidate: true }
          )
          setConfirmReset(false)
        }}
      />
    </>
  )
}
