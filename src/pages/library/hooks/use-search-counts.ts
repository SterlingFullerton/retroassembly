import useSWR from 'swr'
import { client, parseResponse } from '#@/api/client.ts'
import { useSearchQuery } from '../components/library-layout/atoms.ts'

const { $get } = client.roms.search_counts

/** While searching, how many games match on each console, in all, and among favorites and played games */
export function useSearchCounts() {
  const [query] = useSearchQuery()
  return useSearchCountsFor(query)
}

/** The same counts for any search, such as what's being typed in the phone's search screen */
export function useSearchCountsFor(query: string) {
  const { data } = useSWR(
    query ? { endpoint: 'roms/search_counts', query: { query } } : null,
    ({ query }) => parseResponse($get({ query })),
    { dedupingInterval: 60 * 1000, keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false },
  )
  return query ? data : undefined
}

/** A sidebar link's count while searching: undefined for Home, and when not searching */
export function getLinkCount(counts: ReturnType<typeof useSearchCounts>, name: string) {
  if (!counts || name === 'home') {
    return
  }
  if (name === 'library') {
    return counts.games
  }
  if (name === 'favorites' || name === 'history') {
    return counts[name]
  }
  return counts.platforms[name] ?? 0
}
