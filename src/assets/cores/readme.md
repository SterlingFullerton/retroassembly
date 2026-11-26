# Emulators built for this fork

RetroArch's official browser build has no emulator for these consoles, so they're built here from libretro's source
with Emscripten 3.1.74 and RetroArch 9b56a92, and shipped with the app. Each `<core>_libretro.zip` holds the
`.js` and `.wasm` the build produces; patches, where a core needs them, sit beside it.

| Emulator           | Console              | Source                                                                                                                                                                                  |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a5200`            | Atari 5200           | [libretro/a5200](https://github.com/libretro/a5200) 40c6f2f                                                                                                                             |
| `prosystem`        | Atari 7800           | [libretro/prosystem-libretro](https://github.com/libretro/prosystem-libretro) 8a88014                                                                                                   |
| `stella2014`       | Atari 2600           | [libretro/stella2014-libretro](https://github.com/libretro/stella2014-libretro) 4a7da82                                                                                                 |
| `mupen64plus_next` | Nintendo 64          | [libretro/mupen64plus-libretro-nx](https://github.com/libretro/mupen64plus-libretro-nx) f275caf, with `mupen64plus_next_libretro.patch` and `mupen64plus_next_libretro.retroarch.patch` |
| `desmume`          | Nintendo DS          | [libretro/desmume](https://github.com/libretro/desmume) 95b4d79, with `desmume_libretro.patch` and `desmume2015_libretro.retroarch.patch`                                               |
| `desmume2015`      | Nintendo DS          | [libretro/desmume2015](https://github.com/libretro/desmume2015) 422b688, with its patches                                                                                               |
| `melonds`          | Nintendo DS          | [libretro/melonDS](https://github.com/libretro/melonDS) 4081e83, with `melonds_libretro.patch` and `desmume2015_libretro.retroarch.patch`                                               |
| `ppsspp`           | PlayStation Portable | EmulatorJS's copy of PPSSPP fa917eb, with its patches; `ppsspp_assets.zip` holds its fonts and dialog graphics                                                                          |

The emulators for every other console are RetroArch's official ones, packed from libretro's build server by
`scripts/retroarch-cores.ts`.

These emulators are licensed under the GPL; their source is at the links above.
