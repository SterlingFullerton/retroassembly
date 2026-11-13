/**
 * RetroArch fits the picture to the screen again only when told the window was resized. Called after a console's
 * Rotate button, so once the turned picture is drawn it's told so, and an upright picture then fits above the controls.
 */
export function refitGame() {
  setTimeout(() => globalThis.dispatchEvent(new Event('resize')), 300)
}
