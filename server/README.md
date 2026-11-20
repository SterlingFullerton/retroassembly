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
  `GET /api/v1/roms/on_this_day`, `GET /api/v1/roms/play_together`. These say which covers the server's CDN cache has,
  which only the Node server knows yet, so with `RETROASSEMBLY_RUN_TIME_CDN_CACHE=true` they stay the Node server's

With `RETROASSEMBLY_GO_NODE_URL` set to a running Node server, everything else (the rest of `/api/`, `/cdn/`, logging
in with OIDC) is passed on to it, so the Go server can stand in front of the Node server while the API moves over.
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

What the Go server needs from the TypeScript definitions (the default settings, the consoles in order, which consoles'
game pages are cross-origin isolated, the languages with the messages the server writes and their date formats) is in
`internal/shared/shared.json`, written by `node scripts/go-shared-data.ts`.
A unit test fails when it's out of date.

How settings are resolved and merged, and how games are found and ranked by a search (Fuse.js's typo-tolerant matching
included), are checked against the TypeScript code's own answers, in `internal/preference/testdata/typescript.json`
and `internal/search/testdata/typescript.json`, written by `node scripts/go-test-fixtures.ts`.

## Passwords

Each password hash takes 64 MiB. The server makes it in a short-lived child process of its own executable (started with
`argon2id-child`), so that memory is given back the moment the hash is made: made in the server itself, the garbage
collector frees it, but the system can go on counting it against the server.
