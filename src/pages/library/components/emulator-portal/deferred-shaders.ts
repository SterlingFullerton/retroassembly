// A console's shader picked in the pause menu is saved on the server at once, but kept out of the page's
// settings until the game is left: the running game's emulator is prepared from those settings, and changing them while
// it plays would have the page prepare another in its place. The game's exit puts them in

let deferred: Record<string, string> = {}

/** Notes a console's shader, picked while its game runs */
export function deferShader(platform: string, shader: string) {
  deferred[platform] = shader
}

/** The shaders picked since the last call, by console, and forgets them */
export function takeDeferredShaders() {
  const taken = deferred
  deferred = {}
  return taken
}
