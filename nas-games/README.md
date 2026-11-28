# Games on the NAS

The game service: runs games on the NAS for devices that can't run them, and sends each player the picture and sound
over WebRTC, as play together does. Players join from the app's join page. The app's side is
`server/internal/nasgames` and `server/internal/web/nas_games_handlers.go`.

- `serve.go`: the service the app calls (`host serve`). It starts each game as this same program run again, with a UDP
  port of its own, and stops a game nobody has been in for a while, after saving a state of it. Every request needs the key in `SERVICE_KEY`.
- `main.go`, `frontend.c`: one game. A small libretro frontend runs the emulator with an OpenGL context on the GPU and
  no screen; each frame is encoded (H.264) and sent at once, and the sound (Opus) on a steady 10 ms clock.
- `players.go`, `commands.go`: players joining, their controllers, and their pause menus.

Settings: `SERVICE_KEY` (required, 32 characters or more), `MAX_GAMES` (3), `IDLE_MINUTES` (1; a game with nobody
in it is stopped after this), `QUIET_MINUTES` (15; a game with players in it but nobody moving anything is stopped
after this, or twice this while paused), `FIRST_MEDIA_PORT` (47900; one port each game, the next ones after),
`ICE_INTERFACES` (the network interfaces players reach the NAS on, with the container on the host's network),
`ROMS_DIR` (/roms), `SAVE_DIR` (/config/saves), `STATES_MB_PER_PLAYER` (2048) and `STATES_MB_IN_ALL` (20480; past
these, the oldest save states go). A game is given only the settings it needs, never `SERVICE_KEY`.

Saves: each game keeps its own save in a folder of its own, `SAVE_DIR/<player>/games/<id>`, with a note of the game,
until the app has collected its last save; the folder then goes. A service started again collects what such folders
still hold. Save states are kept in `SAVE_DIR/<player>/states/<game>/<emulator>`, the service's own (kept as it stops
an idle game) in `auto` there. Stopped (SIGTERM), the service stops every game, each keeping its save, in under 20
seconds.

Tests: `docker build --target test .`, as CI runs them: the service builds only on Linux, with its libraries.

Emulators: every one the app uses, in `/cores`, from libretro's build server, but melonDS, which is built here from
the same source and patch as the browser's (`patches/melonds.patch`, a copy of `src/assets/cores/melonds_libretro.patch`).
A console's emulator is found by the name the app gives it. A DS's touch screen is the stylus a player sends with their
controller.
