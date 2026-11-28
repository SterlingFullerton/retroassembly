# The Go server

The app's server: it serves the browser app (TypeScript, in `src/`) and its API. It replaced a Node server, moved over a
piece at a time and merged in pull request 3. Comments naming `src/...` files that no longer exist name the Node code a
part was ported from: `git show ee0408ee^:<path>` shows it as it was just before the Node server was removed.

## What it serves

- The built browser app (`dist/client`): its files, compressed copies, and `index.html` for every page
- `/robots.txt`, `/build-version`, `/` (to the library)
- Signing in and out: `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `PATCH /api/v1/auth/password`,
  `GET /api/v1/users/current`, `/logout`
- Stored files: `GET /api/v1/files/*`
- Favorites: `POST /api/v1/favorites`, `DELETE /api/v1/favorites/{romId}`
- Play history: `POST /api/v1/launch_records`, `DELETE /api/v1/roms/{id}/launch_records`
- Settings: `GET` and `POST /api/v1/preference`, `POST` and `DELETE /api/v1/preference/bioses`
- Save states: `GET` and `POST /api/v1/states`, `DELETE /api/v1/states/{id}`, `GET /api/v1/roms/{id}/states`
- In-game saves: `GET` and `POST /api/v1/game_saves`, `POST /api/v1/game_saves/{id}/restore`
- Games: `GET /api/v1/roms/by_files`, `GET /api/v1/roms/{id}/content`, `GET /api/v1/roms/search_counts`
- Accounts, for the admin: `GET` and `POST /api/v1/users`, `PATCH` and `DELETE /api/v1/users/{id}`
- Adding games: `POST /api/v1/roms`, streamed to disk, looked up in the game info database
  (`GAME_INFO_DB`, or `game-info/game-info.sqlite`; without it, games are added by their
  file names), and PSP discs compressed to CSO afterwards
- Editing and deleting games: `PATCH` and `DELETE /api/v1/roms/{id}`, `DELETE /api/v1/roms`, `POST` and
  `DELETE /api/v1/roms/{id}/boxart`, `POST /api/v1/roms/{id}/thumbnail`,
  `DELETE /api/v1/roms/{id}/thumbnail/{thumbnailId}`
- Lists of games: `GET /api/v1/launch_records`, `GET /api/v1/roms/search`, `GET /api/v1/roms/rediscover`,
  `GET /api/v1/roms/on_this_day`, `GET /api/v1/roms/play_together`
- The pages' data: `GET /api/v1/pages/common` and `/api/v1/pages/login`, and the library's pages
  (`/api/v1/pages/library`, `.../home`, `/roms`, `/consoles`, `/favorites`, `/history`, `/platform`, `/rom`)
- The CDN cache, with `CDN_CACHE=true`: `/cdn/*`, which downloads jsDelivr's, libretro's and LaunchBox's
  files once and keeps them in the data folder (libretro's art in the artwork folder, when one is set), the covers
  each game list says the cache has (LaunchBox's front cover, from the game info database, for a game libretro has no
  box art for), the WebP copies of images (made with libwebp, built into the server), offline mode (`CDN_OFFLINE`),
  how long a missing file is remembered (`CDN_RECHECK_DAYS`), whether downloaded images are kept beside their WebP copies (`CDN_KEEP_ORIGINALS`) and the prefetch at startup (`CDN_PREFETCH`).
  The cache's files are kept as the Node server kept them, so a cache it filled is used as it is
- Logging in with OIDC: `/login/oidc` and `/login/oidc/callback`. The provider must be reached over https; one with a
  certificate of its own is trusted through `NODE_EXTRA_CA_CERTS`, the setting the Node server read it from (the CDN
  cache trusts the same certificates, for a network that inspects TLS). An identity whose username belongs to an account
  with a password isn't linked to it, unless `OIDC_LINK_PASSWORD_ACCOUNTS=true` (for a library
  moving from passwords to OIDC, on a provider where users can't pick their own username)

Before it listens, it checks the data folder and any folders set for files, moves box art uploaded before an artwork
folder was set into it, brings the database up to date, and groups the discs of games uploaded before discs were
grouped. Once listening, it fills in the game info of games matched before it was kept, downloads what the CDN prefetch
names, and compresses PSP ISOs.

It takes the same settings the Node server did, by shorter names (`ROMS_DIR` for `RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY`;
see `Names` in `internal/config`, and the old names still work), and the same data folder: password hashes,
sessions, ids, file ids and the migrations Drizzle records are all kept as the Node server kept them, so a library the
Node server set up is used as it is.

Where it differs from the Node server, on purpose:

- A new game or BIOS file is named by its whole content (the first 16 hex digits of its SHA-256), not by its first and
  last kilobyte and its size, which two different files can share. Files already stored keep their names
- Request bodies are limited: 64 KiB for forms of text, 1 MiB for JSON, 100 MiB for an image, 512 MiB for a save state,
  in-game save or BIOS (game uploads are streamed to disk and aren't limited). A larger one is answered with 413
- A request that changes something (anything but `GET`, `HEAD` and `OPTIONS`) from another site, as the browser's
  `Sec-Fetch-Site` header says (or, from a browser without it, its `Origin`), is refused with 403. Pages may be framed
  only by the sites `FRAME_ANCESTORS` lists, the app itself by default
- The server has one library, and each account a role in it: a player plays; a contributor also adds and edits games;
  an admin also deletes them and manages the accounts. Saves, favorites and history are each account's own. Games
  that accounts kept in libraries of their own, before this, are brought into the server's when it starts.
- The server has one set of BIOS files too, kept in the owner's settings: everyone plays with them and only admins
  add or remove them. Those accounts kept in their own settings are brought into it when the server starts.
- Only the first account can sign up, and is the admin; an admin adds the others, unless `OPEN_SIGNUP=true` lets anyone
  sign up, as a player, up to 3 accounts an hour from one address. New passwords are at least 8 characters. New
  usernames are 2 to 32 letters a to z, digits, dots, dashes and underscores; a few, such as Server, are reserved, and
  one that looks like another account's (adm1n beside admin) or a deleted one's is refused. Older names keep working
- Each player's and contributor's save states and game saves may take up to `SAVES_QUOTA_GB` (10 GiB by default, 0
  for no limit); past that a save is answered with 507 and stays queued on the device. Saves are only of the app's
  emulators, and a save state's picture is at most 8 MiB
- Deleting an account removes its saves, save states, favorites, play history and settings, rows and files, and
  forgets its name, password, address and browser. Its row stays, marked deleted, with only a hash of its name, so no
  one takes it. Accounts deleted before this are finished when the server starts
- A request's address is the connection's. Behind a reverse proxy, set `TRUSTED_PROXIES` to the proxy's address or
  range, as the app sees it; requests from there are then taken to come from the last address in `X-Forwarded-For`
  that isn't the proxy's own. Without it every visitor has the proxy's address, and the limits below are shared
- At most 2 password hashes are made at a time, and 32 more wait; past that, a sign-in is answered with 503. One address
  may have 8 sign-ins under way, and 10 wrong passwords for a username in 15 minutes, 50 for all (`SIGN_IN_ATTEMPTS`
  sets the 10, 0 for no limit); past that, it's answered with 429. Signing in to an account that doesn't exist takes as
  long as to one that does
- Session tokens are 32 random bytes. A password session renews itself while it's used, but not past 90 days
- An account that shares the admin's library uses the admin's BIOS files on a console it has none of its own for.
  Settings keep only the BIOS files the user uploaded, of the app's consoles; a BIOS file no one has any more is deleted
- Box art and screenshots no game shows any more, a deleted game's pictures, and a game's file once no game uses it are
  deleted. Save states and in-game saves are streamed to disk rather than held in memory
- On `SIGTERM` or `SIGINT` it stops taking requests and lets those under way finish, for up to 8 seconds
- At startup it removes files that writes cut short left behind (`*.partial`, `*.tmp`) once they're a day old. A PSP
  disc that doesn't get smaller as a CSO is kept as an ISO, with an `.uncompressed` file beside it so it isn't tried
  again; a CSO an earlier run left is checked against its ISO before it replaces it
- The CDN cache sends its files with `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`,
  remembers only a 404 or 410 as missing (another refusal is tried again next time), and doesn't convert an image of
  more than 40 megapixels to WebP. It keeps files of up to 64 MiB, runs 8 downloads at once, refuses addresses with a
  fragment, takes libretro's art only at the version the app asks for, and skips a host for a while only when it
  doesn't answer
- A CSO the startup repair didn't write (aligned further than the app aligns one) is left alone, and a background job
  that panics is logged rather than taking the server down

## Running it

Go 1.27 or later. `pnpm build` builds the browser app and this server, to `dist/retroassembly`; `pnpm start` runs it.
`pnpm dev` builds and starts it behind Vite (see `vite.config.ts`), on the first free port after Vite's, and stops when
it stops.

The Docker image is Alpine with the binary in `/app/retroassembly`: it has a shell, `wget` (for health checks such as
`wget -qO- http://localhost:8000/build-version`), the certificate authorities and the time zones, but no Node, so a
health check or script that ran `node` in the container needs changing. It runs the server as `PUID`:`PGID` (1000 by
default) through `scripts/docker-entrypoint.sh`, which first hands that user the files root owns in the data folder and
the folders the settings name: those earlier images wrote.

It reads `dist/client`, `src/databases/migrations` and `game-info/game-info.sqlite` from the folder it's started in (or
`CLIENT_DIR`, `MIGRATIONS_DIR` and `GAME_INFO_DB`). Without `dist/client`, as in development, it serves the API alone.

### Upgrades and going back

A version that changes the database first copies it beside itself, as `retroassembly.sqlite.before-<first change>` in
the data folder, then makes its changes in one transaction. The five newest copies are kept. If the copy can't be made,
the database is left as it was and the server doesn't start.

To go back to an earlier version after such an upgrade, stop the container, put that copy back as
`retroassembly.sqlite`, and start the earlier image. Anything saved since the upgrade is not in the copy. An earlier
version started on an upgraded database refuses to start and says so, rather than running with tables it doesn't
expect.

It's built with the `nodynamic` tag, which keeps the WebP encoder from loading a system libwebp: without it, Go links
the binary against the system's C library, and it no longer runs on a static base image.

## Checking it

```sh
node --run=test:go
```

What the Go server needs from the TypeScript definitions (the default settings, the consoles in order and their names'
translation keys, which consoles' game pages are cross-origin isolated and whose games come on several discs, the
languages with the messages the server writes and their date formats, what the CDN cache may fetch and what its prefetch
downloads) is in `internal/shared/shared.json`, written by `node scripts/go-shared-data.ts`. A unit test fails when it's
out of date.

The login with OIDC is checked against a test provider (`internal/oidctest`), which also runs on its own, over https,
for trying the login by hand: `go -C server run ./test/oidc-provider -certificate /tmp/oidc-provider.pem`, then start
the server with `NODE_EXTRA_CA_CERTS=/tmp/oidc-provider.pem`, `OIDC_ISSUER` set to
`https://localhost:8300`, and the client and secret it prints.

How settings are resolved and merged, how games are found and ranked by a search (Fuse.js's typo-tolerant matching
included), and which files the CDN cache fetches and which covers it finds for a game, are checked against the
TypeScript code's own answers, in `internal/*/testdata`. They were written by the Node server's code
(`scripts/go-test-fixtures.ts`, removed with it), and are kept as they were: the answers the Go server must keep giving.
The one change since: libretro's art at a version other than the one the app pins is refused.

## Passwords

Each password hash takes 64 MiB. The server makes it in a short-lived child process of its own executable (started with
`argon2id-child`), so that memory is given back the moment the hash is made: made in the server itself, the garbage
collector frees it, but the system can go on counting it against the server.
