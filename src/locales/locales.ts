import cs from './cs.json' with { type: 'json' }
import de from './de.json' with { type: 'json' }
import { canadianize } from './en-ca.ts'
import en from './en.json' with { type: 'json' }
import es from './es.json' with { type: 'json' }
import fr from './fr.json' with { type: 'json' }
import it from './it.json' with { type: 'json' }
import ja from './ja.json' with { type: 'json' }
import ko from './ko.json' with { type: 'json' }
import pt from './pt.json' with { type: 'json' }
import ru from './ru.json' with { type: 'json' }
import zhCN from './zh-CN.json' with { type: 'json' }
import zhTW from './zh-TW.json' with { type: 'json' }

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

export const locales = [
  { code: 'cs', name: 'Čeština', translation: cs },
  { code: 'de', name: 'Deutsch', translation: de },
  { code: 'en', name: 'English', translation: en },
  { code: 'en-CA', name: 'English (Canada)', translation: canadianize(en) },
  { code: 'es', name: 'Español', translation: es },
  { code: 'fr', name: 'Français', translation: fr },
  { code: 'it', name: 'Italiano', translation: it },
  { code: 'ja', name: '日本語', translation: ja },
  { code: 'ko', name: '한국어', translation: ko },
  { code: 'pt', name: 'Português', translation: pt },
  { code: 'ru', name: 'Русский', translation: ru },
  { code: 'zh-CN', name: '简体中文', translation: zhCN },
  { code: 'zh-TW', name: '繁體中文', translation: zhTW },
]

// Plural forms differ by language, so keys are compared without their plural suffix
function getBaseKeys(translation: Record<string, string>) {
  const keys = Object.keys(translation).map((key) => key.replace(/_(?:zero|one|two|few|many|other)$/u, ''))
  return new Set(keys)
}

if (import.meta.env?.DEV || import.meta.main) {
  const englishKeys = getBaseKeys(en)
  for (const { code, translation } of locales) {
    const keys = getBaseKeys(translation)
    const missing = [...englishKeys].filter((key) => !keys.has(key))
    const extra = [...keys].filter((key) => !englishKeys.has(key))
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Locale ${code} does not have the same keys as English. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}`,
      )
    }
  }
}
