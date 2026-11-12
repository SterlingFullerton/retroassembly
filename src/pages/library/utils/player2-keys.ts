// Keys for a second player on the same keyboard. Player 1's hands are at the edges (the arrows, and Z, X, A and S),
// so player 2 sits between them: I, J, K and L to move, D, F, C and V for Y, X, B and A, E and T for L and R, and 2 to
// start and 6 to insert a coin, as on arcade emulators.
const player2Keys = {
  input_player2_a: 'v',
  input_player2_b: 'c',
  input_player2_down: 'k',
  input_player2_l: 'e',
  input_player2_left: 'j',
  input_player2_r: 't',
  input_player2_right: 'l',
  input_player2_select: 'num6',
  input_player2_start: 'num2',
  input_player2_up: 'i',
  input_player2_x: 'f',
  input_player2_y: 'd',
}

export type Player2KeyboardMapping = Partial<typeof player2Keys>

// Player 2's keys, leaving out any key already bound to something else
export function getPlayer2KeyboardMapping(keyboardMapping: Record<string, unknown>): Player2KeyboardMapping {
  const usedKeys = new Set(Object.values(keyboardMapping))
  return Object.fromEntries(Object.entries(player2Keys).filter(([, key]) => !usedKeys.has(key)))
}
