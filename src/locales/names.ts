export const localeCodes = [
  'cs',
  'de',
  'en',
  'en-CA',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'zh-CN',
  'zh-TW',
] as const

export type LocalCode = (typeof localeCodes)[number]

/** The languages the app can be shown in, by their own names. Their text is in locales.ts, and loaded only when used */
export const localeNames: { code: LocalCode; name: string }[] = [
  { code: 'cs', name: 'Čeština' },
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
]
