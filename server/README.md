# The Go server

The server being moved from Node to Go, a piece at a time (see [docs/go_migration_plan.md](../docs/go_migration_plan.md)).
The browser app stays TypeScript; this serves it and its API.

## What it serves so far

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
- Editing and deleting games: `PATCH` and `DELETE /api/v1/roms/{id}`, `DELETE /api/v1/roms`, `POST` and
  `DELETE /api/v1/roms/{id}/boxart`, `POST /api/v1/roms/{id}/thumbnail`,
  `DELETE /api/v1/roms/{id}/thumbnail/{thumbnailId}`
- Lists of games: `GET /api/v1/launch_records`, `GET /api/v1/roms/search`, `GET /api/v1/roms/rediscover`,
  `GET /api/v1/roms/on_this_day`, `GET /api/v1/roms/play_together`
- The pages' data: `GET /api/v1/pages/common` and `/api/v1/pages/login`, and the library's pages
  (`/api/v1/pages/library`, `.../home`, `/roms`, `/consoles`, `/favorites`, `/history`, `/platform`, `/rom`)
- The CDN cache, with `RETROASSEMBLY_RUN_TIME_CDN_CACHE=true`: `/cdn/*`, which downloads jsDelivr's and libretro's
  files once and keeps them in the data folder (libretro's art in the artwork folder, when one is set), the covers
  each game list says the cache has, the WebP copies of images (made with libwebp, built into the server), offline
  mode (`RETROASSEMBLY_RUN_TIME_CDN_OFFLINE`) and the prefetch at startup (`RETROASSEMBLY_RUN_TIME_CDN_PREFETCH`).
  The cache's files are the Node server's, so either server uses what the other downloaded
- Logging in with OIDC: `/login/oidc` and `/login/oidc/callback`. As with the Node server, the provider must be reached
  over https; one with a certificate of its own is trusted through `NODE_EXTRA_CA_CERTS`, the file Node reads

With `RETROASSEMBLY_GO_NODE_URL` set to a running Node server, everything else (uploading games) is passed on to it, so the Go server can stand in front of the Node server while the API moves over.
Without it, those answer 501.

It uses the same data folder, database and settings (`RETROASSEMBLY_RUN_TIME_*`) as the Node server, and can run on
the same data folder at the same time. Password hashes, sessions, ids, file ids and the migrations Drizzle records are
all kept as the Node server keeps them.

## Running it

Go 1.27 or later. From the repository root, after building the browser app with `pnpm build`:

```sh
go -C server build -o ../dist/retroassembly-go ./cmd/retroassembly
RETROASSEMBLY_RUN_TIME_PORT=8001 RETROASSEMBLY_GO_NODE_URL=http://localhost:8000 dist/retroassembly-go
```

It reads `dist/client` and `src/databases/migrations` from the folder it's started in (or
`RETROASSEMBLY_GO_CLIENT_ROOT` and `RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY`).

## Checking it

```sh
go -C server vet ./... && go -C server test ./...
```

`server/test/shared-data.sh` checks the two servers against each other on one data folder: start the Node server and
this one on the same empty data folder, then run it with `DATA_DIRECTORY`, `NODE_URL` and `GO_URL`.

What the Go server needs from the TypeScript definitions (the default settings, the consoles in order and their names'
translation keys, which consoles' game pages are cross-origin isolated, the languages with the messages the server
writes and their date formats, what the CDN cache may fetch and what its prefetch downloads) is in
`internal/shared/shared.json`, written by `node scripts/go-shared-data.ts`. A unit test fails when it's out of date.

The login with OIDC is checked against a test provider (`internal/oidctest`), which also runs on its own, over https,
for checking both servers against it: `go -C server run ./test/oidc-provider -certificate /tmp/oidc-provider.pem`, then
start the servers with `NODE_EXTRA_CA_CERTS=/tmp/oidc-provider.pem`, `RETROASSEMBLY_RUN_TIME_OIDC_ISSUER` set to
`https://localhost:8300`, and the client and secret it prints.

How settings are resolved and merged, how games are found and ranked by a search (Fuse.js's typo-tolerant matching
included), and which files the CDN cache fetches and which covers it finds for a game, are checked against the
TypeScript code's own answers, in `internal/*/testdata/typescript.json`, written by `node scripts/go-test-fixtures.ts`.

## Passwords

Each password hash takes 64 MiB. The server makes it in a short-lived child process of its own executable (started with
`argon2id-child`), so that memory is given back the moment the hash is made: made in the server itself, the garbage
collector frees it, but the system can go on counting it against the server.
