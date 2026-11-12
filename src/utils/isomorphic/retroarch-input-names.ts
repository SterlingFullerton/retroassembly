// The app's input settings call the shoulder buttons L1 and R1, but RetroArch names them l and r
// (input_player1_l, input_player1_l_btn). RetroArch ignores names it doesn't know, so without this a remapped L or R
// key or button had no effect and RetroArch's own defaults stayed in place.
export function toRetroarchInputNames(mapping: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(mapping).map(([name, value]) => [
      name.replace(/^(?<player>input_player\d+_)(?<side>[lr])1(?<suffix>_btn)?$/u, '$<player>$<side>$<suffix>'),
      value,
    ]),
  )
}
