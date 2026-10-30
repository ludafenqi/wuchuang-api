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
import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Main } from './main'
import { PageFooterProvider } from './page-footer'

type SlotProps = { children?: ReactNode }

function SectionPageLayoutTitle(_props: SlotProps) {
  return null
}
SectionPageLayoutTitle.displayName = 'SectionPageLayout.Title'

function SectionPageLayoutActions(_props: SlotProps) {
  return null
}
SectionPageLayoutActions.displayName = 'SectionPageLayout.Actions'

function SectionPageLayoutContent(_props: SlotProps) {
  return null
}
SectionPageLayoutContent.displayName = 'SectionPageLayout.Content'

function SectionPageLayoutBreadcrumb(_props: SlotProps) {
  return null
}
SectionPageLayoutBreadcrumb.displayName = 'SectionPageLayout.Breadcrumb'

function SectionPageLayoutDescription(_props: SlotProps) {
  return null
}
SectionPageLayoutDescription.displayName = 'SectionPageLayout.Description'

export type SectionPageLayoutProps = {
  children: ReactNode
  fixedContent?: boolean
  stackActionsOnMobile?: boolean
}

export function SectionPageLayout(props: SectionPageLayoutProps) {
  const [footerContainer, setFooterContainer] = useState<HTMLDivElement | null>(
    null
  )

  let title: ReactNode = null
  let actions: ReactNode = null
  let content: ReactNode = null
  let breadcrumb: ReactNode = null
  let description: ReactNode = null

  Children.forEach(props.children, (node) => {
    if (!isValidElement(node)) return
    const child = node as ReactElement<SlotProps>
    if (child.type === SectionPageLayoutTitle) title = child.props.children
    else if (child.type === SectionPageLayoutActions) {
      actions = child.props.children
    } else if (child.type === SectionPageLayoutContent) {
      content = child.props.children
    } else if (child.type === SectionPageLayoutBreadcrumb) {
      breadcrumb = child.props.children
    } else if (child.type === SectionPageLayoutDescription) {
      description = child.props.children
    }
  })

  return (
    <PageFooterProvider container={footerContainer}>
      <Main>
        <div className='wcai-page-heading shrink-0 border-b px-4 py-5 sm:px-8 sm:py-6 lg:px-10'>
          {breadcrumb != null && (
            <div className='mb-2 sm:mb-3'>{breadcrumb}</div>
          )}
          <div className='flex flex-col items-stretch justify-between gap-4 @3xl/content:flex-row @3xl/content:items-center'>
            <div
              className={
                props.stackActionsOnMobile
                  ? 'min-w-0 flex-1 max-sm:basis-full'
                  : 'min-w-0 flex-1'
              }
            >
              <h2 className='text-2xl leading-tight font-semibold tracking-tight break-words sm:text-[1.75rem]'>
                {title}
              </h2>
              {description != null && (
                <p className='text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed'>
                  {description}
                </p>
              )}
            </div>
            {actions != null && (
              <div className='flex max-w-full shrink-0 flex-wrap items-center justify-start gap-2 @3xl/content:justify-end'>
                {actions}
              </div>
            )}
          </div>
        </div>

        <div
          className={
            props.fixedContent
              ? 'min-h-0 flex-1 overflow-hidden px-4 py-5 sm:px-8 sm:py-6 lg:px-10'
              : 'min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-8 sm:py-6 lg:px-10'
          }
        >
          {content}
        </div>

        <div
          ref={setFooterContainer}
          className='bg-background shrink-0 border-t px-3 py-2.5 empty:hidden sm:px-4 sm:py-3'
        />
      </Main>
    </PageFooterProvider>
  )
}

SectionPageLayout.Title = SectionPageLayoutTitle
SectionPageLayout.Actions = SectionPageLayoutActions
SectionPageLayout.Content = SectionPageLayoutContent
SectionPageLayout.Breadcrumb = SectionPageLayoutBreadcrumb
SectionPageLayout.Description = SectionPageLayoutDescription
