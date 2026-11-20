# Moving the server to Go

A plan for replacing the Node server (Hono, Drizzle, React Router server rendering) with a Go server, while the
browser app stays React and TypeScript. Based on `origin/main` at `6db66210`.

## Goals

- One static binary serving the API, stored files, the CDN cache and the built browser app
- Lower memory: about 170 MB today, aiming for 30–50 MB when idle
- **No change for existing installs**: same data folder, same database file, same environment variables, same URLs,
  existing passwords and sessions keep working

## Not changing

- The browser app (`src/pages`, `src/emulator`, `src/input`, `src/consoles`): about 23k lines stay TypeScript
- The build-time scripts (`scripts/game-info.ts`, `scripts/retroarch-cores.ts`): they stay Node, run at build time only
- The Playwright end-to-end tests: they drive a browser, so they test the Go server as they are and serve as the check
  that it behaves the same

## What gets ported

| Area             | Today                                                                   | Lines  |
| ---------------- | ----------------------------------------------------------------------- | ------ |
| API routes       | `src/api/routes/**` (Hono + zod)                                        | ~770   |
| Controllers      | `src/controllers/**` (41 files)                                         | ~2,200 |
| Server utilities | `src/utils/server/**`                                                   | ~2,500 |
| Middleware       | `src/middlewares/*` (globals, vendors, logger, cdn cache, require user) | ~220   |
| Server entry     | `src/server/*`                                                          | ~180   |
| Page loaders     | 9 `loader()` functions in `src/pages/routes/*`                          | —      |
| Schema           | `src/databases/schema.ts`, 9 tables, 12 SQL migrations                  | ~210   |

## Target layout

```
server/                        Go module (go.mod at server/)
  cmd/retroassembly/main.go    boot: check folders, migrate, listen, start background jobs
  internal/config/             RETROASSEMBLY_RUN_TIME_* settings, folders (env.ts, storage-path.ts)
  internal/db/                 sqlc queries, migrations runner, the one connection
  internal/auth/               argon2, sessions, cookie, OIDC
  internal/scope/              LibraryScope: current user, library owner, shared-library rules
  internal/storage/            files on disk: put via temp file + rename, ranged reads, ETag
  internal/api/                one file per route group, same paths as /api/v1 today
  internal/pages/              JSON for the page loaders, and the index.html fallback
  internal/cdncache/           /cdn/* cache, prefetch, WebP copies
  internal/gameinfo/           game info lookup against game-info.sqlite
  internal/cso/                PSP ISO → CSO compression
  internal/i18n/               server-side messages from src/locales/*.json (embedded)
```

## Library choices

| Need                      | Node today                  | Go                                                                             |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| HTTP routing              | Hono                        | `net/http` (Go 1.22+ method and wildcard patterns)                             |
| Request validation        | zod                         | small hand-written checks per handler; the forms are simple                    |
| SQLite driver             | better-sqlite3              | `modernc.org/sqlite` (pure Go, no C compiler)                                  |
| Queries                   | Drizzle                     | `sqlc` against the existing SQL, plus `database/sql` for the few dynamic ones  |
| Migrations                | Drizzle migrator            | own small runner that reads Drizzle's `__drizzle_migrations` table (see below) |
| Password hashes           | `node:crypto` argon2id      | `golang.org/x/crypto/argon2`                                                   |
| OIDC                      | openid-client               | `github.com/coreos/go-oidc/v3` + `golang.org/x/oauth2`                         |
| WebP copies               | sharp                       | decide: `govips` (needs libvips) or drop the conversion (see open questions)   |
| CSO compression           | `node:zlib` deflateRaw      | `compress/flate`                                                               |
| Response compression      | `hono/compress`             | `github.com/klauspost/compress/gzhttp`                                         |
| Date formats              | luxon                       | `time` plus a small translator for the luxon tokens used in `dateFormatMap`    |
| IDs                       | nanoid (`nolookalikes`, 10) | `github.com/matoous/go-nanoid/v2` `Generate` with the same alphabet and length |
| API types for the browser | Hono `hc` client type       | OpenAPI from Go (`huma` or hand-written spec) → `openapi-typescript`           |

## Compatibility that must not slip

Each of these gets a Go test that reads data written by the current Node server.

1. **Password hashes.** `src/utils/server/argon2.ts` writes `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` with
   **base64url** salt and hash, not the standard base64 of the PHC format. Go must decode and write the same encoding.
2. **Migrations.** Drizzle records applied migrations by hash in `__drizzle_migrations`. The Go runner must treat that
   table as the source of truth, so an existing database isn't migrated twice, and new migrations after the switch
   are added to the same folder and table.
3. **Column names and types.** Drizzle uses `casing: 'snake_case'`, timestamps are integer milliseconds, JSON columns
   (`raw_game_metadata`, `user_preferences.*`) are text. sqlc models must match exactly.
4. **IDs.** `src/utils/server/nanoid.ts` uses nanoid-dictionary's `nolookalikes` alphabet at length 10, not
   nanoid's default. Go must use the same alphabet and length.
5. **Session cookie.** Name `token`, `HttpOnly`, `SameSite=Lax`, `Secure` on https, `Path=/`; the `Authorization:
   Bearer` header is accepted as well.
6. **File ids and paths.** `storage-path.ts` maps an id to a folder per kind of file and refuses ids that reach
   outside it. Port it with the path-traversal tests.
7. **File responses.** ETag `"<size base36>-<mtime ms base36>"`, ranges, 304s, the sandbox CSP and `nosniff`
   (`src/api/routes/utils.ts`).
8. **Headers.** Cross-origin isolation for the PSP game pages and their workers (`cross-origin-isolation.ts`), no
   compression for `/api/v1/files/*` and ROM content.
9. **Logs.** Combined Log Format, as `src/middlewares/logger.ts` writes it.
10. **Settings.** Every `RETROASSEMBLY_RUN_TIME_*` variable in `src/constants/env.ts`, with the same defaults and the
    same start-up checks for missing or read-only folders.

## Phases

Each phase ships on its own and keeps the end-to-end tests passing.

### Phase 0: Turn off server rendering (still Node)

The one change that needs the browser app to change. Doing it on Node first means it can be tested and shipped without
Go in the picture.

- Set React Router to single-page mode (`ssr: false` in `react-router.config.ts`)
- Move the 9 page `loader()`s to JSON endpoints, under `/api/v1/pages/*`:
  `library` (layout: recent games, is admin), `library/home`, `library/roms`, `library/consoles`,
  `library/favorites`, `library/history`, `library/platform/:platform`, `library/platform/:platform/rom/:fileName`,
  `login`
- Turn each route's `loader` into a `clientLoader` that fetches its endpoint; keep `shouldRevalidate` as it is
- `/`, `/logout`, `/login/oidc` and `/login/oidc/callback` become plain server routes that redirect
- The common data from `getCommonLoaderData` (auth mode, current user, language, preference, run-time limits) becomes
  one `/api/v1/pages/common` endpoint
- Language: the server no longer renders HTML, so the browser picks the language from the preference or
  `navigator.languages`; check the first paint doesn't flash in the wrong language
- **Done when:** the end-to-end tests pass with server rendering off, and memory is measured again (the expected drop
  from not loading React on the server is useful to know on its own)

### Phase 1: Go skeleton beside Node

- `server/` Go module, config, database connection, migration runner reading Drizzle's table
- argon2, sessions, `globals` middleware (current user, library owner, preference, language), logger
- Storage and `GET /api/v1/files/*`
- Static files: serve `dist/client`, precompressed `.br`/`.gz` as `scripts/precompress.ts` writes them, `index.html`
  for every page path, `/robots.txt`, `/build-version`
- Run it on another port against a copy of a real data folder
- **Done when:** Go signs in a user created by Node, reads their files, and leaves the database as Node expects it

**Status: done.** See [server/README.md](../server/README.md).

- Also ported: `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `GET /api/v1/users/current`, `/logout`, and
  `/` redirecting to the library. Any other `/api/` address answers 501
- `server/test/shared-data.sh` runs both servers on one data folder at once: each signs in the other's accounts, knows
  the other's sessions and sends the other's files with the same headers, and the database stays as Node expects it
- Answers match the Node server's byte for byte for the ported routes, but for the order of the attributes in the
  cookie cleared on logout, and a stored file that's missing on disk, which Go answers with 404 where Node answers 500
- Password hashes are made in a short-lived child process, so the 64 MiB each takes is given back at once
- Preference and language aren't loaded per request yet: nothing ported needs them. They come with the API groups that do
- Memory (macOS physical footprint): idle about 7 MB, 12 MB at the most after 27 logins, 6 of them at once. The Node
  server, which also renders nothing now: 43 MB after a few logins and uploads, 130 MB at the most

### Phase 2: Port the API, group by group

Put Go in front: it answers what it has ported and passes everything else to Node (`httputil.ReverseProxy`), so each
group ships alone and the end-to-end tests run against the mix.

Order, from least to most involved:

1. `users/current`, `auth` (login, register, password), `/logout`
2. `favorites`, `launch_records`, `preference` (+ BIOS upload and delete)
3. `states`, `game_saves` (multipart uploads, `clientId` deduplication, keeping the latest versions)
4. `roms` reads: list, search, search counts, by files, content, home picks, disc groups (`listedOnce`,
   `discCount` subqueries in `library-scope.ts`)
5. `roms` writes: streamed upload straight to disk (`stream-form-data.ts`), game info lookup, edit, box art,
   thumbnails, delete, bulk delete
6. `users` admin routes
7. `pages/*` endpoints from phase 0
8. OIDC login and callback

API types: from step 1, generate an OpenAPI spec from the Go handlers and TypeScript types from it, and move the
browser app's `client.*` calls (25 files) to a small typed `fetch` wrapper as each group lands.

**Status: done.** Every group is Go's.

- Go stands in front of Node when `RETROASSEMBLY_GO_NODE_URL` is set, passing on whatever it doesn't answer yet
- Done: 1 (with `PATCH /api/v1/auth/password`); 2, except `GET /api/v1/launch_records`, which needs the search and
  cover matching of step 4 and moves there; 3, with `GET /api/v1/roms/{id}/states`. The same upload sent several times
  at once is still stored once, and the same saves and files are kept as on Node
- In-game saves: restoring a version whose file is missing on disk answers 404 where Node answers 500
- Done: 4's API routes: `GET /api/v1/launch_records`, `/roms/search`, `/roms/search_counts`, `/roms/rediscover`,
  `/roms/on_this_day`, `/roms/play_together`, `/roms/by_files`, `/roms/{id}/content`. The search ranking, Fuse.js's
  typo-tolerant matching included, is checked against the TypeScript code's own rankings
  (`server/internal/search/testdata`). With the CDN cache on, the lists stay Node's until phase 3, as only Node knows
  which covers the cache has. The game lists of the pages (`getRoms`, the letters) come with step 7
- Done: 5, but uploading games: editing a game (`PATCH /api/v1/roms/{id}`), its box art and screenshots, deleting one
  or several. The server's messages come in the browser's language (`Accept-Language`, matched as Hono matches it),
  from the TypeScript translations (`scripts/go-shared-data.ts`), and typed dates are read as Luxon reads them
- Done, once `origin/main` was merged: uploading games (`POST /api/v1/roms`). The file is streamed straight to the
  games folder with busboy's limits, the game is looked up in the game info database (`server/internal/gameinfo`:
  by MD5, then by name in its several forms, with goodcodes-parser's reading of regions to pick a release, and LaunchBox
  again without revision tags), stored under its digest, its discs grouped, and a PSP ISO compressed afterwards. The
  name handling and every lookup are checked against the TypeScript code's answers from the same small database
  (`server/internal/gameinfo/testdata`); uploads to both servers store the same rows, info and files
- Difference: a 413 says "Request Entity Too Large", as Go's HTTP server words it, where Node says "Payload Too Large"
- Quirk kept from Node: saving a game's details without a player count or a release date clears them
- Done: 6, the admin's account routes (`GET` and `POST /api/v1/users`, `PATCH` and `DELETE /api/v1/users/{id}`)
- Done: 7, the pages' data (`/api/v1/pages/*`): the data every page shares and the login page's, always; the library's
  pages (layout, home, games, consoles, favorites, history, a console, a game) while the CDN cache is off, as they list
  games. With it, the game lists (`getRoms` with its orders, directions, favorites and a search's pages in match order,
  the A to Z letters, games with states, disc groups, console counts), the library pages' language (the user's chosen
  one, the browser's elsewhere), and a game's page title, from `goodcodes-parser`'s file name cleaning and
  `moveArticleToFront` (checked against the TypeScript code in `title_test.go`)
- Difference: the settings in the shared page data and in `GET /api/v1/preference` have their keys in alphabetical
  order (consoles, keyboard keys) where Node keeps the defaults' order. The values are the same
- Done: 8, logging in with OIDC (`/login/oidc`, `/login/oidc/callback`), with `go-oidc` and `x/oauth2` in place of
  `openid-client`: PKCE, state, nonce and the callback's issuer checked, accounts found, linked by username or made as
  Node does, the required role, and the session's length. As with `openid-client`, the provider must be reached over
  https, and a certificate of its own is trusted through `NODE_EXTRA_CA_CERTS`. Checked against Node with the same test
  provider (`server/internal/oidctest`, `server/test/oidc-provider`): the same redirects, cookies, accounts and sessions
- Next: 5's uploads, once `origin/main` is merged; then phase 3
- Quirks kept from Node: `GET /api/v1/launch_records` ignores `page_size` (always 100); game lists give `isFavorite` as
  1 or 0, the picks and history as true or false. Among games that tie on everything search ranks by, the order may
  differ from Node's, which takes it from the order SQLite reads the rows in
- Checked by sending the same requests, errors included, to Node alone and to Go in front of Node, and with the
  end-to-end tests through Go in front of Node: the same tests pass as on Node alone
- The default settings and the consoles come from the TypeScript definitions (`scripts/go-shared-data.ts`), and how
  settings are resolved and merged is checked against the TypeScript code's own answers (`scripts/go-test-fixtures.ts`)
- API types: the browser app's types still come from the Node server's routes, which stay until phase 4. Generating
  them from Go waits until then, when they would otherwise be lost
- Two small differences, from Node's own quirks: Node remembers a library's consoles for a minute, so right after a
  first game is added Go may already list a console Node doesn't yet; and a request the browser stops waiting for is
  no longer logged as a proxy error

### Phase 3: Background jobs and the CDN cache

- `/cdn/*` cache and its prefetch job (`cdn-cache.ts`, `cdn-prefetch.ts`), the WebP decision below
- PSP compression (`cso.ts`, `compress-psp-games.ts`), port `tests/unit/cso.test.ts` alongside
- Game info backfill (`migration/raw-metadata.ts`), disc groups update, moving uploaded artwork
- **Done when:** Go no longer proxies anything to Node

**Status: done.** Go no longer passes anything to Node.

- Done: the CDN cache (`server/internal/cdn`): `/cdn/*`, the covers every game list notes (`coverCandidates`,
  libretro's box art matched by title included), libretro's art in the artwork folder, offline mode, and the prefetch.
  With it, the game lists and the library's pages are Go's whether the cache is on or not. The WebP copies are made
  with `gen2brain/webp`, libwebp translated to Go, so the server stays one static binary; at the same quality as sharp,
  the copies come out within a few bytes of Node's. Each conversion takes tens of MB while it runs, so two run at a
  time and the memory is given back when the last ends: converting 24 covers, six asked for at once, Go peaked at
  114 MB and was back to 17 MB right after (macOS physical footprint); Node peaked at 167 MB from 111 MB. The binary
  grew to 25 MB
- The cache's files, notes and copies are kept as Node keeps them, so the two servers share one cache: Node serves
  what Go downloaded and the copies Go made. What the cache may fetch, the covers it looks for and the matching by
  title are checked against the TypeScript code's answers (`server/internal/cdn/testdata`), and the whole cache
  against Node with real downloads from jsDelivr
- Differences: an address under `/cdn/` with a broken escape (`%E0%A4%A`) is refused by Go's HTTP server with 400
  before it's read, where Node answers 500; an empty 404 says `Content-Length: 0`
- While both servers run, each starts its own prefetch if `RETROASSEMBLY_RUN_TIME_CDN_PREFETCH` is set for both: they
  download into the same cache safely, but twice. Set it for the Go server only
- Done: the startup tasks: discs uploaded before grouping existed are grouped, with each game's saves, favorites and
  history moved to its first disc, and box art uploaded before an artwork folder was set is moved into it. Disc names
  are read as `parseDisc` reads them (checked against it, `server/internal/library/testdata/discs.json`); started on
  copies of the same data folder, Node and Go leave the same database and files
- Done: PSP compression (`server/internal/psp`, with `tests/unit/cso.test.ts` ported) and the game info backfill, run
  in the background once the server is listening, as on Node. Started on copies of the same data, the two leave the
  same database and files, and log the same lines. Go's CSOs are about 0.2% larger, as Go's deflate isn't zlib's;
  each server reads the other's
- While Node still runs behind Go, it runs its own startup jobs too. They do the same work and can overlap safely: Go
  compresses under a temporary name of its own, so the two never write the same file
- The end-to-end tests through Go send nothing on to Node. The tests that start a game fail at times on Node alone too
  since the merge (the game is still loading when the screenshot is taken), so they say nothing about Go either way

### Phase 4: Remove Node from the server

- Dockerfile: Node stage builds the browser app and the emulator files; final image is the Go binary plus
  `dist/client`, `game-info.sqlite` and the cores (`distroless/static` or `alpine`)
- `pnpm dev`: Vite for the browser app, proxying `/api`, `/cdn`, `/cores` to `go run ./server/cmd/retroassembly`
  (`air` for reloads)
- Delete `src/api`, `src/controllers`, `src/middlewares`, `src/server`, `src/utils/server`, Hono, Drizzle,
  better-sqlite3, sharp, openid-client
- Update `AGENTS.md` for the new layout and commands

**Status: done.** The Node server, its tests and its dependencies are gone; the Go server is the app's server.

- The browser app's API types are a TypeScript route map (`src/api/routes-types.ts`, with the data in
  `src/api/types.ts`), with a small client in the shape Hono's had (`src/api/request.ts`), so the pages' calls stayed as
  they were. Before the Node server was removed, each route's types were checked to match what Hono inferred from it
- `pnpm dev`: Vite serves the browser app, and builds and starts the Go server on the next port, passing `/api`,
  `/cdn`, `/login/oidc` and `/logout` to it. `pnpm build` builds both; `pnpm start` runs `dist/retroassembly`
- Dockerfile: Node builds the browser app, the emulator files and the game info database; Go builds the server for each
  platform; the image is Alpine (for a shell and `wget` in health checks) with the binary, the built app, the
  migrations and the game info database. The Node stages run on the build machine only, since what they make is the
  same on every platform. The binary is built with the `nodynamic` tag, so the WebP encoder never loads a system
  libwebp, which would make it a dynamically linked binary. In Docker it uses 12 MiB once started
- CI sets up Go, checks it's `gofmt`ed, and runs its tests (`node --run=test:go`) and the unit tests before the
  end-to-end tests
- The fixtures the Go tests compare against (`server/internal/*/testdata`) were written by the Node server's code; they
  stay as the answers the Go server must keep giving
- The unit tests of the Node server's code went with it; what they checked is checked by the Go tests
- The full Docker image was built and checked: the end-to-end tests pass against it on a fresh library; on a library the
  last Node server made (accounts, games, box art, a save state, an in-game save, a favorite, play history, a setting),
  the library's reads answer as Node's did, Node's sessions and passwords still sign in, stored files come back
  unchanged, and new games, states, deletions and a password change last through a restart. It's 371 MB, uses about
  10 to 22 MiB, and stops at once on `docker stop`. The full build found that the preview server React Router starts to
  prerender the app loaded the dev-only code that starts the Go server; that code now runs only for `pnpm dev`

### After the switch: an adversarial review

Five reviews looked for what the move broke or kept broken. What was fixed (`server/README.md` lists what now differs
from the Node server):

- Password hashes written with the standard base64 alphabet are read; hashing is bounded and stops with its request;
  an unknown username takes as long to refuse as a wrong password; two sign-ups can't take the same username
- Request bodies are limited; writes from other sites are refused; the server shuts down gracefully
- A BIOS for an unknown console is refused before anything is written (it could reach outside the BIOS folder);
  stored files are named by their whole content; adding a game and its file happen in one transaction
- OIDC doesn't link an identity to an account with a password unless told to
- The CDN cache trusts `NODE_EXTRA_CA_CERTS`, recovers from a panicking conversion, doesn't remember a passing refusal
  as a missing file, sandboxes what it serves, skips huge images and parses each cover list once at a time
- Files are synced before they're renamed into place; leftovers of interrupted writes are removed at startup; PSP
  compression checks a CSO left from before and keeps an ISO that doesn't shrink
- The port is read as Node read it (`8080.0`, `0x1f90`); the server listens on IPv6 as well as IPv4
- `pnpm dev` picks a free port for the Go server instead of passing requests to whatever already listens there

## Code that both sides use

About 30 server files import code the browser app also uses. What moves where:

| Shared code                                  | Plan                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `src/locales/*.json`                         | Go embeds them; only the few server-side messages are read (`error.*`)     |
| `src/constants/preference.ts` (defaults)     | Write the defaults to a JSON file at build time; both sides read it        |
| `src/constants/platform*.ts`, `src/consoles` | Generate a JSON of platform names and file extensions at build time for Go |
| `utils/isomorphic/search.ts`, `discs.ts`     | Port to Go; add a shared table of test cases (JSON) both test suites run   |
| `utils/isomorphic/i18n.ts` `dateFormatMap`   | Port the map; same test cases on both sides                                |

## Open questions

1. ~~**WebP copies of CDN images.**~~ Decided: made in pure Go with `gen2brain/webp` (libwebp translated to Go), at
   the same quality as before, keeping the static binary.
2. **Phase 2 proxy, or a single switch.** The proxy lets each group ship alone, but two servers run side by side for a
   while. A single switch is simpler but larger.
3. **First paint without server rendering.** The library opens to an empty layout until its data arrives. Is a loading
   skeleton enough, or should Go inline the first page's data into `index.html`?
4. **Version for upstream merges.** Upstream keeps changing the Node server; after phase 2 starts, those changes no
   longer merge cleanly into this fork.

## Rough effort

| Phase                   | Estimate                                           |
| ----------------------- | -------------------------------------------------- |
| 0. Server rendering off | 3–5 days                                           |
| 1. Go skeleton          | 3–4 days                                           |
| 2. API port             | 7–10 days                                          |
| 3. Jobs and CDN cache   | 3–5 days                                           |
| 4. Remove Node          | 1–2 days                                           |
| **Total**               | **about 3–5 weeks** of focused work for one person |
