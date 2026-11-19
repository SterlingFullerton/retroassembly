import { noop } from 'es-toolkit'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Links, Meta } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import { cdnHost, isCDNCacheEnabled, libretroThumbnailsHost } from '#@/utils/isomorphic/cdn.ts'
import { getFontFaces } from '#@/utils/isomorphic/fonts.ts'

export function Head() {
  const { t } = useTranslation()
  const target = useSyncExternalStore(
    () => noop,
    () => (globalThis.self === globalThis.top ? '_self' : '_blank'),
    () => '_self',
  )

  return (
    <head>
      <meta charSet='utf-8' />
      <meta content='width=device-width,initial-scale=1,viewport-fit=cover,shrink-to-fit=yes' name='viewport' />
      <meta content={metadata.themeColor} name='theme-color' />
      <meta content='telephone=no' name='format-detection' />
      <meta content={metadata.title} name='apple-mobile-web-app-title' />
      <meta content='black-translucent' name='apple-mobile-web-app-status-bar-style' />
      <meta content='yes' name='mobile-web-app-capable' />

      <base target={target} />

      {/* metadata related */}
      <meta content={t(metadata.descriptionI18nKey)} name='description' />

      <link href='/assets/logo/logo-192x192.png' rel='icon' sizes='any' />
      <link href='/assets/logo/logo.svg' rel='icon' type='image/svg+xml' />
      <link href='/assets/logo/apple-touch-icon.png' rel='apple-touch-icon' sizes='any' />

      <link href='/manifest.webmanifest' rel='manifest' />

      <style dangerouslySetInnerHTML={{ __html: getFontFaces() }} />

      <meta content='website' property='og:type' />
      <meta content={metadata.title} property='og:title' />
      <meta content={t(metadata.descriptionI18nKey)} property='og:description' />

      <meta content='summary' name='twitter:card' />
      <meta content={metadata.title} name='twitter:title' />
      <meta content={t(metadata.descriptionI18nKey)} name='twitter:description' />

      {/* perfermance */}
      {(isCDNCacheEnabled() ? [] : [cdnHost, libretroThumbnailsHost]).map((host) => (
        <link key={host} href={host} rel='dns-prefetch' />
      ))}

      <Meta />
      <Links />
    </head>
  )
}
