import { useEffect, useState } from 'react'
import { readStream, type StatsRecord, type StreamStats, type StreamTotals } from '#@/emulator/stream-stats.ts'

const readEvery = 1000

/** Reads a connection's stream once: for a report made on the spot, where there's no last reading to measure from */
export async function readStreamNow(connection: RTCPeerConnection, role: 'guest' | 'host', previous?: StreamTotals) {
  const records: StatsRecord[] = []
  const report = await connection.getStats()
  // The report is a map of records; forEach is how every browser lets it be read
  // eslint-disable-next-line unicorn/no-array-for-each
  report.forEach((record: StatsRecord) => records.push(record))
  return readStream(records, role, previous)
}

/** How the picture is travelling on `connection`, read every second while there is one; nothing before the first reading */
export function useStreamStats(connection: RTCPeerConnection | undefined, role: 'guest' | 'host') {
  const [stats, setStats] = useState<StreamStats>()
  useEffect(() => {
    if (!connection) {
      return
    }
    let previous: StreamTotals | undefined
    let stopped = false
    async function read(from: RTCPeerConnection) {
      try {
        const reading = await readStreamNow(from, role, previous)
        if (!stopped) {
          previous = reading.totals
          setStats(reading.stats)
        }
      } catch {
        // A connection that's closing has nothing to read
      }
    }
    const timer = setInterval(() => read(connection), readEvery)
    return () => {
      stopped = true
      clearInterval(timer)
      setStats(undefined)
    }
  }, [connection, role])
  return connection ? stats : undefined
}
