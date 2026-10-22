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
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { defaultFooterConfig } from '@/features/footer/config'

import type { FooterFormValues } from './section'

export function FooterLinkEditor(props: {
  form: UseFormReturn<FooterFormValues>
}) {
  const { t } = useTranslation()
  const array = useFieldArray({
    control: props.form.control,
    name: 'config.links',
    keyName: 'fieldKey',
  })
  return (
    <fieldset className='min-w-0 space-y-4'>
      <legend className='mb-3 font-semibold'>{t('Footer links')}</legend>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Empty URLs are hidden. API documentation uses the site documentation URL when empty. Legal links appear only when their content is configured.'
        )}
      </p>
      {array.fields.map((entry, index) => (
        <fieldset
          key={entry.fieldKey}
          className='grid min-w-0 gap-4 rounded-xl border p-4 sm:grid-cols-2'
        >
          <legend className='px-1 text-sm'>
            {t('Link')} {index + 1}
          </legend>
          {(['label', 'url', 'group'] as const).map((name) => (
            <FormField
              key={name}
              control={props.form.control}
              name={`config.links.${index}.${name}`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t(
                      { label: 'Display name', url: 'URL', group: 'Group' }[
                        name
                      ]
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={{ label: 80, url: 2048, group: 40 }[name]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <div className='flex flex-wrap items-center gap-5'>
            {(['visible', 'external'] as const).map((name) => (
              <FormField
                key={name}
                control={props.form.control}
                name={`config.links.${index}.${name}`}
                render={({ field }) => (
                  <FormItem className='flex items-center gap-2'>
                    <FormLabel>
                      {t(name === 'visible' ? 'Visible' : 'External link')}
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
          </div>
          <div className='flex flex-wrap gap-2 sm:col-span-2'>
            <Button
              type='button'
              variant='outline'
              disabled={index === 0}
              onClick={() => array.move(index, index - 1)}
            >
              {t('Move up')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={index === array.fields.length - 1}
              onClick={() => array.move(index, index + 1)}
            >
              {t('Move down')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => array.remove(index)}
            >
              {t('Delete')}
            </Button>
          </div>
        </fieldset>
      ))}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={array.fields.length >= 40}
          onClick={() =>
            array.append({
              id: crypto.randomUUID(),
              label: t('Link'),
              url: '',
              group: '',
              visible: true,
              external: false,
              source: 'custom',
            })
          }
        >
          {t('Add link')}
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={array.fields.length > 33}
          onClick={() => {
            const sources = new Set(
              props.form.getValues('config.links').map((link) => link.source)
            )
            array.append(
              defaultFooterConfig()
                .links.filter((link) => !sources.has(link.source))
                .map((link) => ({ ...link, id: crypto.randomUUID() }))
            )
          }}
        >
          {t('Add default links')}
        </Button>
      </div>
    </fieldset>
  )
}
