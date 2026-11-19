/**
 * The game cover size setting, in points, per size: in a list (`list`, the narrowest a game may be, more fitting in a row
 * where there's room; `phoneList` on a phone or tablet held upright), and in one of Home's rows (`row`, `phoneRow`)
 */
export const coverSizes: Record<string, { list: number; phoneList: number; phoneRow: number; row: number }> = {
  'extra-large': { list: 240, phoneList: 220, phoneRow: 160, row: 208 },
  'extra-small': { list: 144, phoneList: 96, phoneRow: 96, row: 120 },
  large: { list: 216, phoneList: 160, phoneRow: 136, row: 176 },
  medium: { list: 192, phoneList: 140, phoneRow: 112, row: 144 },
  small: { list: 168, phoneList: 100, phoneRow: 104, row: 132 },
}

export function getCoverSize(size: string) {
  return coverSizes[size] ?? coverSizes.medium
}
