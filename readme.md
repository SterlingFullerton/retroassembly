<p align="center">
  <img src="public/assets/logo/logo-512x512.png" alt="logo" width="100" height="100">
  <h1 align="center">RetroAssembly</h1>
</p>

A personal retro game library in the browser: upload your games, browse them by console, and play with a keyboard,
a controller or on-screen controls, with saves kept on your own server.

This is an independent fork, maintained separately from the original project.

## Features

- Home page with what you're playing, games to rediscover, favourites, recently added and games to play together
- Navigation built for the keyboard and controllers, with a highlight that follows the focus
- Game pages with an editor for box art, details, description, screenshots and videos
- Games on several discs grouped into one, with disc switching while playing
- The games' own saves (memory cards, battery saves) kept alongside snapshots
- PlayStation Portable games
- Games kept on the device for quicker starts, and a page to manage them
- Shared libraries: other accounts can play the owner's games with their own saves

## Running it

RetroAssembly runs as a Docker container. A minimal `compose.yaml`:

```yaml
services:
  retroassembly:
    build: https://github.com/SterlingFullerton/retroassembly.git
    ports:
      - '8000:8000'
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Then run `docker compose up -d` and open `http://localhost:8000`. The first account created is the administrator.

PlayStation Portable games need the page to be served over HTTPS (or `localhost`), as the emulator runs on several
threads.

### Running without internet access

By default, the browser loads emulator cores, shaders, fonts, and artwork from public CDNs. To serve them from your own server instead, set:

| Variable           | Default | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDN_CACHE`        | `false` | When `true`, these files are requested through your server, which downloads each one once and keeps it in `data/cache/cdn`                                                                                                                                                                                                                                                                            |
| `CDN_PREFETCH`     | Unset   | Downloads files into the cache when the server starts, so they are available before first use: a comma-separated list of `cores`, `shaders`, `assets` (fonts and artwork) and `thumbnails` (box art, title screens, screenshots and logos for every ROM in the library). `all` means everything except `thumbnails`, about 65 MB; `thumbnails` can take several GB. Requires `CDN_CACHE` to be `true` |
| `CDN_OFFLINE`      | `false` | When `true`, the server never downloads from the CDNs while pages are browsed: it serves only what's in the cache, and files are added only by the prefetch when it starts (restart it to fetch art for newly added games). Requires `CDN_CACHE` to be `true`                                                                                                                                         |
| `CDN_RECHECK_DAYS` | `30`    | How many days a file found missing upstream is remembered before it's looked for again; `0` never looks again. Requires `CDN_CACHE` to be `true`                                                                                                                                                                                                                                                      |

Unless `thumbnails` is prefetched, box art and screenshots are cached once someone views them. Box art comes from [libretro's thumbnails](https://thumbnails.libretro.com/), and, for a game libretro has none for, from [LaunchBox's games database](https://gamesdb.launchbox-app.com/) when the CDN cache is on.

### Other settings

| Variable                                              | Default                      | Description                                                                                                                |
| ----------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                | `8000`                       | The port the server listens on                                                                                             |
| `DATA_DIR`                                            | `data`                       | The database, the cache, and the storage folder unless `STORAGE_DIR` is set                                                |
| `STORAGE_DIR`                                         | `data/storage`               | Stored files: the folders below that aren't set                                                                            |
| `ROMS_DIR`, `SAVES_DIR`, `STATES_DIR`, `BIOSES_DIR`   | In `STORAGE_DIR`             | Games, in-game saves, save states and BIOS files, each in a folder of its own, such as the games on a large disk           |
| `ARTWORK_DIR`                                         | Unset                        | Uploaded box art, and libretro's art when `CDN_CACHE` is `true`, under readable names; art put there by hand is used first |
| `CACHE_DIR`                                           | `data/cache`                 | The CDN cache                                                                                                              |
| `GAME_INFO_DB`                                        | `game-info/game-info.sqlite` | The game information database built with the app                                                                           |
| `MAX_UPLOAD`                                          | `1000`                       | How many files one upload may pick                                                                                         |
| `MAX_ROMS`                                            | Unset                        | How many games a library may hold                                                                                          |
| `MAX_AUTO_STATES`                                     | `20`                         | How many automatic save states are kept per game                                                                           |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Unset                        | Sign-in with an OpenID Connect provider instead of passwords; see `server/README.md` for the other `OIDC_*` settings       |

The longer names these settings had before (`RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY` and so on) still work.

## Supported consoles

Emulation is powered by [Nostalgist.js](https://nostalgist.js.org/) and RetroArch cores.

| Console                                 | Available Emulators                                |
| --------------------------------------- | -------------------------------------------------- |
| Arcade                                  | `fbneo`, `mame2003_plus`                           |
| Atari 2600                              | `stella2014`                                       |
| Atari 5200                              | `a5200`                                            |
| Atari 7800                              | `prosystem`                                        |
| Atari Lynx                              | `mednafen_lynx`                                    |
| Channel F                               | `freechaf`                                         |
| ColecoVision                            | `gearcoleco`                                       |
| Famicom Disk System                     | `fceumm`, `nestopia`                               |
| Game & Watch                            | `gw`                                               |
| Game Boy                                | `mgba`, `gearboy`, `gambatte`, `tgbdual`           |
| Game Boy Advance                        | `mgba`, `vba_next`                                 |
| Game Boy Color                          | `mgba`, `gearboy`, `gambatte`, `tgbdual`           |
| Game Gear                               | `genesis_plus_gx`, `gearsystem`                    |
| Genesis / Mega Drive                    | `genesis_plus_gx`                                  |
| Magnavox - Odyssey2 / Philips Videopac+ | `o2em`                                             |
| Master System                           | `genesis_plus_gx`, `picodrive`, `gearsystem`       |
| N64                                     | `mupen64plus_next`                                 |
| Neo Geo Pocket                          | `mednafen_ngp`                                     |
| Neo Geo Pocket Color                    | `mednafen_ngp`                                     |
| NES / Family Computer                   | `fceumm`, `nestopia`, `quicknes`                   |
| PC Engine (TurboGrafx 16)               | `mednafen_pce_fast`                                |
| PlayStation                             | `pcsx_rearmed`                                     |
| PlayStation Portable                    | `ppsspp`                                           |
| Sega SG-1000                            | `gearsystem`                                       |
| Super NES / Super Famicom               | `snes9x`, `snes9x2002`, `snes9x2005`, `snes9x2010` |
| Virtual Boy                             | `mednafen_vb`                                      |
| WonderSwan                              | `mednafen_wswan`                                   |
| WonderSwan Color                        | `mednafen_wswan`                                   |

## Credits

Based on [RetroAssembly](https://github.com/arianrhodsandlot/retroassembly) by arianrhodsandlot, released under the
MIT License.

## License

[MIT](license)
