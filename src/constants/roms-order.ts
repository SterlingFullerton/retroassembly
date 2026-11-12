export const romsOrders = ['added', 'name', 'played', 'popular', 'released'] as const
export type RomsOrder = (typeof romsOrders)[number]

/** Game lists open sorted by popularity */
export const defaultRomsOrder: RomsOrder = 'popular'

/** Popular and Most played read from the top; the rest from A, or the oldest */
export function getDefaultRomsDirection(order: string) {
  return order === 'popular' || order === 'played' ? 'desc' : 'asc'
}
