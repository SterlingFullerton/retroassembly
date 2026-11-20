import { useRouteLoaderData } from 'react-router'
import type { clientLoader as loader } from '#@/pages/root.tsx'

// What the root route loads for every page: the user, their settings, the language and the app's limits
export function useGlobalLoaderData() {
  const data = useRouteLoaderData<typeof loader>('root')
  if (!data) {
    throw new Error('useGlobalLoaderData must be used within the app')
  }
  return data
}
