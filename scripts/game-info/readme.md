# Game info

A game's name, year, developer, publisher, players, genres and description, looked up when it's added to the library.
The lookup runs on the server, in a database built with the app by `scripts/game-info.ts` from two public sources:

- [libretro's database](https://buildbot.libretro.com/assets/frontend/database-rdb.zip), which knows each release's
  file and MD5
- [LaunchBox's games database](https://gamesdb.launchbox-app.com/Metadata.zip), which has the descriptions

The Docker build downloads both and rebuilds the database whenever either changes. To build it locally:

```bash
node scripts/game-info.ts database-rdb.zip Metadata.zip
```

It's written to `game-info/game-info.sqlite` (set `GAME_INFO_DB` to use another file).
Without it, games are added by their file names alone.

## Credit

The tables and the matching are adapted from [msleuth](https://github.com/arianrhodsandlot/msleuth), which the app
used to ask over the internet. msleuth is under the MIT license:

> Copyright (c) arianrhodsandlot
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of
> the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
> THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
> TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Changes from msleuth: it reads the app's own console list, so it covers Nintendo DS, PSP and Channel F, which msleuth
didn't match; and when libretro lists several entries for a game, it picks the plain release for the file's region and
disc rather than the first one, which was often a hack, translation or bad dump.
