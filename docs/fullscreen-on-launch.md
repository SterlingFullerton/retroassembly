# Full screen on launch

2026-11-19. Applies to the RetroAssembly fork, as deployed in c1d8a3fe.

## Current behaviour

On phones and tablets ("Go fullscreen on launch" left on Automatic), tapping Start or Continue puts the page in
full screen right away, before the game has finished downloading (`launch()` in
`src/pages/library/components/emulator-portal/hooks/use-emulator.ts`). The game appears once it's ready.

Since c1d8a3fe, the page can scroll while in full screen, and the Start or Continue button, with its download progress,
is brought to the middle of the screen. Before that, the browser pinned the page in place: the progress could be out of
sight with no way to scroll to it.

## The limitation

Browsers only allow full screen just after a tap or a key press. In Chrome that permission lasts about 5 seconds;
after that, a request is refused. On iPhone the page can't go full screen at all. Requesting full screen as soon as
Start is tapped is the only way to be sure it's allowed.

| Game                                                            | Ready within ~5 s? |
| --------------------------------------------------------------- | ------------------ |
| Most consoles (small files)                                     | Yes                |
| A PSP game already on the device                                | Yes                |
| A PSP game's first play, or after it's removed (hundreds of MB) | No                 |

If the app waited for the game, every long download would end with full screen refused and the game playing with the
browser's bars showing. A second request is already made when the game starts (`start()`); it only succeeds when the
game was quick.

## Possible solutions

### 1. Keep it as it is (current)

Full screen at the tap; the download progress is kept in view.

- Works for every game with one tap.
- During a long download, the page sits in full screen, which can look as if the game has stalled.

### 2. Full screen when ready, with "Tap to play" after long downloads (recommended)

Full screen is requested when the game is ready. If the browser refuses it because the tap was too long ago, a
"Tap to play" button covers the screen; tapping it gives a fresh permission, goes full screen and starts the game.

- The page stays normal while downloading, with the progress where you left it.
- No extra tap for small games or games already on the device.
- One extra tap after a long download, which also confirms you're still there to play.
- Needs a mockup of the "Tap to play" screen first.

### 3. Full screen only for games that are ready quickly

Before launching, the app checks whether the game is small or already on the device. If so, full screen at the tap, as
now. If not, no full screen for that launch: the game plays with the browser's bars, and the in-game full-screen
button can be used.

- No new screen to design.
- After a long download the game doesn't fill the screen until you press the full-screen button yourself.

### 4. Download first, then ask

A long download shows its progress on the game's page; when it's done, Start becomes "Play", and a tap on it goes full
screen and starts at once.

- Close to option 2, but the extra tap is on the page's own button rather than a new screen.
- Starting a long download and starting the game become two separate steps.

### 5. Install as an app

A site added to the home screen with `"display": "fullscreen"` in its web app manifest opens without the browser's
bars at all, so the full-screen request isn't needed.

- Only helps when it's opened from the home screen icon, and only on Android.
- Independent of the options above; can be added alongside any of them.

## Recommendation

Option 2. It keeps one tap for most games and only adds a tap when a long download makes it unavoidable.
