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

// Every language's text at once: for the scripts and tests that go through them all. The app itself loads one language
// at a time (utils/isomorphic/i18n.ts)
export { type LocalCode, localeCodes } from './names.ts'

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

// For translators: German and Czech address the player formally (Sie, vy), as do French and Russian (vous, вы); Spanish,
// Italian and Portuguese informally (tú, tu, você)

// Plural forms differ by language, so keys are compared without their plural suffix
function getBaseKeys(translation: Record<string, string>) {
  const keys = Object.keys(translation).map((key) => key.replace(/_(?:zero|one|two|few|many|other)$/u, ''))
  return new Set(keys)
}

const pluralSuffix = /_(?:zero|one|two|few|many|other)$/u

/**
 * The plural forms a language is missing for text English counts: each form its language uses for a whole number up to
 * a thousand, such as Russian's "few" and "many". A key without a suffix stands for "one", as i18next falls back to it
 */
export function getMissingPluralForms(code: string, translation: Record<string, string>) {
  const counted = new Set(
    Object.keys(en)
      .filter((key) => pluralSuffix.test(key))
      .map((key) => key.replace(pluralSuffix, '')),
  )
  const rules = new Intl.PluralRules(code)
  const forms = new Set(Array.from({ length: 1001 }, (_, count) => rules.select(count)))
  return [...counted].flatMap((key) =>
    [...forms]
      .filter((form) => !(`${key}_${form}` in translation) && !(form === 'one' && key in translation))
      .map((form) => `${key}_${form}`),
  )
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
    const missingForms = getMissingPluralForms(code, translation)
    if (missingForms.length > 0) {
      throw new Error(`Locale ${code} is missing plural forms: ${missingForms.join(', ')}`)
    }
  }
}
