import { useAtom, useSetAtom } from 'jotai'
import useSWRMutation from 'swr/mutation'
import { client, type InferRequestType, parseResponse } from '#@/api/client.ts'
import { defaultPreference, type PreferenceSnippet } from '#@/constants/preference.ts'
import { preferenceAtom, preferenceSaveFailedAtom } from '#@/pages/atoms.ts'

const { $post } = client.preference

export function usePreference() {
  const [preference, setPreference] = useAtom(preferenceAtom)
  const setSaveFailed = useSetAtom(preferenceSaveFailedAtom)

  const { isMutating: isLoading, trigger } = useSWRMutation(
    { endpoint: 'preference', method: 'post' },
    (_key, { arg: json }: { arg: InferRequestType<typeof $post>['json'] }) => $post({ json }),
  )

  async function update(value: PreferenceSnippet) {
    if (value) {
      // A change that doesn't reach the server leaves its control as it was; the settings say why (see the dialog's
      // note). It's still thrown, for whoever asked to stop there
      let newPreference
      try {
        newPreference = await parseResponse(trigger(value))
      } catch (error) {
        setSaveFailed(true)
        throw error
      }
      setSaveFailed(false)
      setPreference(newPreference)
      return newPreference
    }
    return preference
  }

  return { isLoading, preference: preference || defaultPreference, setPreference, update }
}
