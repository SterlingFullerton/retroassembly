# The Go server

The server being moved from Node to Go, a piece at a time (see [docs/go_migration_plan.md](../docs/go_migration_plan.md)).
The browser app stays TypeScript; this serves it and its API.

## What it serves so far (phase 1)

- The built browser app (`dist/client`): its files, compressed copies, and `index.html` for every page
- `/robots.txt`, `/build-version`, `/` (to the library)
- Signing in and out: `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `GET /api/v1/users/current`, `/logout`
- Stored files: `GET /api/v1/files/*`

Any other `/api/` address answers 501 for now.

It uses the same data folder, database and settings (`RETROASSEMBLY_RUN_TIME_*`) as the Node server, and can run on
the same data folder at the same time. Password hashes, sessions, ids, file ids and the migrations Drizzle records are
all kept as the Node server keeps them.

## Running it

Go 1.27 or later. From the repository root, after building the browser app with `pnpm build`:

```sh
go -C server build -o ../dist/retroassembly-go ./cmd/retroassembly
RETROASSEMBLY_RUN_TIME_PORT=8001 dist/retroassembly-go
```

It reads `dist/client` and `src/databases/migrations` from the folder it's started in (or
`RETROASSEMBLY_GO_CLIENT_ROOT` and `RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY`).

## Checking it

```sh
go -C server vet ./... && go -C server test ./...
```

`server/test/shared-data.sh` checks the two servers against each other on one data folder: start the Node server and
this one on the same empty data folder, then run it with `DATA_DIRECTORY`, `NODE_URL` and `GO_URL`.

What the Go server needs from the TypeScript definitions (which consoles' game pages are cross-origin isolated) is in
`internal/shared/shared.json`, written by `node scripts/go-shared-data.ts`. A unit test fails when it's out of date.

## Passwords

Each password hash takes 64 MiB. The server makes it in a short-lived child process of its own executable (started with
`argon2id-child`), so that memory is given back the moment the hash is made: made in the server itself, the garbage
collector frees it, but the system can go on counting it against the server.
