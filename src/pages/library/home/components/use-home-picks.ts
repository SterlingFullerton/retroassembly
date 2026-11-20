import { useState } from 'react'
import useSWR from 'swr'
import { client, parseResponse } from '#@/api/client.ts'

// Home's rows of picks, loaded once the page is up so it opens quickly. Rediscover and Play together are different each
// time they're fetched; Shuffle fetches again

const options = { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false }

export function useRediscoverPicks() {
  return useSWR({ endpoint: 'roms/rediscover' }, () => parseResponse(client.roms.rediscover.$get()), options)
}

export function usePlayTogetherPicks() {
  return useSWR({ endpoint: 'roms/play_together' }, () => parseResponse(client.roms.play_together.$get()), options)
}

/** Games released on today's date by this device's clock, which may be a different day from the server's */
function today() {
  const now = new Date()
  return {
    date: `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    year: now.getFullYear(),
  }
}

export function useOnThisDayPicks() {
  // eslint-disable-next-line react/hook-use-state -- today as the page first opened, kept for as long as it stays open
  const [{ date, year }] = useState(today)
  const picks = useSWR(
    { date, endpoint: 'roms/on_this_day' },
    () => parseResponse(client.roms.on_this_day.$get({ query: { date } })),
    options,
  )
  return { ...picks, date, year }
}
