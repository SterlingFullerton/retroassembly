# Games on the NAS

The game service: runs games on the NAS for devices that can't run them, and sends each player the picture and sound
over WebRTC, as play together does. Players join from the app's join page. The app's side is
`server/internal/nasgames` and `server/internal/web/nas_games_handlers.go`.

- `serve.go`: the service the app calls (`host serve`). It starts each game as this same program run again, with a UDP
  port of its own, and stops a game nobody has been in for a while, after saving a state of it. Every request needs the key in `SERVICE_KEY`.
- `main.go`, `frontend.c`: one game. A small libretro frontend runs the emulator with an OpenGL context on the GPU and
  no screen; each frame is encoded (H.264) and sent at once, and the sound (Opus) on a steady 10 ms clock.
- `players.go`, `commands.go`: players joining, their controllers, and their pause menus.

Settings: `SERVICE_KEY` (required, 32 characters or more), `MAX_GAMES` (3), `IDLE_MINUTES` (1), `FIRST_MEDIA_PORT`
(47900; one port each game, the next ones after), `ICE_INTERFACES` (the network interfaces players reach the NAS on,
with the container on the host's network), `ROMS_DIR` (/roms), `SAVE_DIR` (/config/saves).

Emulators: every one the app uses, in `/cores`, from libretro's build server, but two built here:

- melonDS, from the same source and patch as the browser's (`patches/melonds.patch`, a copy of
  `src/assets/cores/melonds_libretro.patch`).
- melonDS DS, for a DS game on two consoles linked as by local wireless, from its 1.4.0 source with
  `patches/melondsds.patch`: its wireless packets handled as melonDS's own multiplayer on one machine does, a console
  that has stopped not waited for, and its buttons as melonDS's (the microphone on L3, making noise, and the lid on L2,
  closed while held).

A console's emulator is found by the name the app gives it. A DS's touch screen is the stylus a player sends with their
controller.
