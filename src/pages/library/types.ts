import type { JSONParsed } from 'hono/utils/types'
import type { Rom as StoredRom } from '#@/controllers/roms/get-roms.ts'

/** A game as the browser has it: loaded as JSON, so its dates are strings */
export type Rom = JSONParsed<StoredRom>
