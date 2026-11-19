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

| Variable                              | Default | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETROASSEMBLY_RUN_TIME_CDN_CACHE`    | `false` | When `true`, these files are requested through your server, which downloads each one once and keeps it in `data/cache/cdn`                                                                                                                                                                                                                                                                            |
| `RETROASSEMBLY_RUN_TIME_CDN_PREFETCH` | Unset   | Downloads files into the cache when the server starts, so they are available before first use: a comma-separated list of `cores`, `shaders`, `assets` (fonts and artwork) and `thumbnails` (box art, title screens, screenshots and logos for every ROM in the library). `all` means everything except `thumbnails`, about 65 MB; `thumbnails` can take several GB. Requires `CDN_CACHE` to be `true` |
| `RETROASSEMBLY_RUN_TIME_CDN_OFFLINE`  | `false` | When `true`, the server never downloads from the CDNs while pages are browsed: it serves only what's in the cache, and files are added only by the prefetch when it starts (restart it to fetch art for newly added games). Requires `CDN_CACHE` to be `true`                                                                                                                                         |

Unless `thumbnails` is prefetched, box art and screenshots are cached once someone views them. Game information is looked up online when a ROM is uploaded.

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
