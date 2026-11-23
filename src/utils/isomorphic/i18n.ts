import { attemptAsync } from 'es-toolkit'
import i18next, { changeLanguage, init } from 'i18next'
import { canadianize } from '#@/locales/en-ca.ts'
import en from '#@/locales/en.json' with { type: 'json' }
import { type LocalCode, localeCodes } from '#@/locales/names.ts'

export const defaultLanguage = 'en'

type Translation = Record<string, string>

// English comes with the app, as the language to fall back on; the others are fetched when one is first used
const resources = { en: { translation: en }, 'en-CA': { translation: canadianize(en) } }

const loaders: Record<string, () => Promise<{ default: Translation }>> = {
  cs: () => import('#@/locales/cs.json'),
  de: () => import('#@/locales/de.json'),
  es: () => import('#@/locales/es.json'),
  fr: () => import('#@/locales/fr.json'),
  it: () => import('#@/locales/it.json'),
  ja: () => import('#@/locales/ja.json'),
  ko: () => import('#@/locales/ko.json'),
  pt: () => import('#@/locales/pt.json'),
  ru: () => import('#@/locales/ru.json'),
  'zh-CN': () => import('#@/locales/zh-CN.json'),
  'zh-TW': () => import('#@/locales/zh-TW.json'),
}

;(async () => {
  await init({
    debug: false,
    fallbackLng: defaultLanguage,
    // React escapes what it shows, so values escaped here too would show as "&amp;"
    interpolation: { escapeValue: false },
    lng: defaultLanguage,
    resources,
    supportedLngs: [...localeCodes],
  })
})()

/** Shows the app in a language, fetching its text first if it hasn't been yet. One that can't be fetched is English */
export async function setLanguage(code: string) {
  const load = loaders[code]
  if (load && !i18next.hasResourceBundle(code, 'translation')) {
    const [, loaded] = await attemptAsync(load)
    if (loaded) {
      i18next.addResourceBundle(code, 'translation', loaded.default)
    }
  }
  await changeLanguage(code)
}

export { i18next as i18n }

const euDateFormat = 'dd/MM/yyyy'
const dotDateFormat = 'dd.MM.yyyy'
const usDateFormat = 'MM/dd/yyyy'
const isoDateFormat = 'yyyy-MM-dd'
const asiaDateFormat = 'yyyy/MM/dd'
export const dateFormats = [asiaDateFormat, dotDateFormat, euDateFormat, isoDateFormat, usDateFormat]

export const dateFormatMap: Record<LocalCode, string> = {
  cs: euDateFormat,
  de: dotDateFormat,
  en: usDateFormat,
  // Year first, as written in Canada
  'en-CA': isoDateFormat,
  es: euDateFormat,
  fr: euDateFormat,
  it: euDateFormat,
  ja: asiaDateFormat,
  ko: asiaDateFormat,
  pt: euDateFormat,
  ru: dotDateFormat,
  'zh-CN': asiaDateFormat,
  'zh-TW': asiaDateFormat,
}
