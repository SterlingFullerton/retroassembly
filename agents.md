# Agent Instructions

## Overview

Self-hosted, browser-based retro gaming platform: a Go server with SQLite and files on local disk, and a React app in
the browser.

**Tech Stack**: React, React Router (SPA mode), Radix Themes, Tailwind CSS, SWR, i18next | Go (`net/http`,
modernc.org/sqlite), Drizzle for the schema and its migrations

## Key Directories

- `server/` - The Go server: the API, the pages' data, the CDN cache and the background jobs (see `server/README.md`)
- `src/databases/schema.ts` - Drizzle schema, which the SQL migrations in `src/databases/migrations` are generated from
- `src/api/client.ts` - Typed API client; `src/api/routes-types.ts` lists each route and `src/api/types.ts` what it sends
- `src/pages/routes.ts` - React Router config
- `scripts/go-shared-data.ts` - What the Go server needs from the TypeScript definitions (consoles, settings, messages)

## Commands

**Development**: `pnpm dev` (port 8000). Vite serves the browser app and builds and starts the Go server on the next
port, passing `/api`, `/cdn`, `/login/oidc` and `/logout` to it. Typically it's already running: check whether port 8000
is in use. Go changes need `pnpm dev` restarted.
**Build**: `pnpm build` (the browser app, then the Go server to `dist/retroassembly`)
**Lint**: `pnpm vp check --fix`. _DO NOT_ ignore warnings, treat them as errors.
**Type check**: It's already included in linting, so no separate command needed. _DO NOT_ run `pnpm tsc`.
**Go**: `node --run=test:go` (`go vet` and `go test`); format with `gofmt -w server`

**E2E Testing** (Playwright):

- Run all: `pnpm test`
- Run single file: `pnpm test tests/e2e/account.test.ts`
- Run by name: `pnpm test -- --grep "log in"`
- Dev mode with UI: `pnpm dev:test -- --headed --ui`

**Database migrations** (Drizzle):

- Generate: `drizzle-kit generate`
- Apply: The Go server applies them when it starts, keeping Drizzle's record of them

## Code Style

**General**: Single quotes, no semicolons, 2-space indentation. File names: lower-snake-case (except `Dockerfile`). Redundant comments are forbidden.

**JavaScript/TypeScript**:

- Use function declarations (`function xx() {}`) over arrow functions
- Modern ECMAScript features preferred
- Complex transforms: `es-toolkit` helpers. Simple cases: `for of`, `.map`, `.flatMap`
- **Never use** `.reduce`, `.then`, `.catch`. Use `async/await` + `attemptAsync` from `es-toolkit`
- Use luxon for date/time parsing/formatting
- Do not use type casting to supress type errors. Prefer `@ts-expect-error` with resonable comments instead.

**Go**:

- `gofmt`, and `go vet` clean
- API errors: return a `failure.New(status, message)` error; the handler answers it with `writeError`
- JSON is written as JavaScript writes it (`writeJSON`), with keys in a fixed order (`library.Object`) where the browser
  app depends on it

**React**:

- Prefer named exports. One component per file.
- `useEffect`: Only when necessary (follow React's "You Might Not Need an Effect")
- Use `clsx` for className manipulation (`import { clsx } from 'clsx'`)
- State: Jotai atoms for local state (create `atom.ts` closest to usage)
- Cleanup: `AbortController` for event listeners
- i18n: `useTranslation` or `Trans` from `react-i18next`

**Error handling**:

- Server: return `failure` errors with a status and message
- Frontend: SWR `onError` or try/catch

## Architecture Patterns

**Database schema**:

- Base fields: `id` (nanoid), `createdAt`, `updatedAt`, `status`
- Soft delete: filter by `status = 1` for active records
- Delete: set `status = 0`

**API client** (`src/api/client.ts`):

```ts
import { client, parseResponse } from '#@/api/client.ts'
const data = await parseResponse(client.users.$get())
```

A new or changed route is added to `src/api/routes-types.ts` (and its data to `src/api/types.ts`) along with the Go
handler in `server/internal/web/server.go`.

**i18n** (12 languages: en, de, es, fr, it, ja, ko, pt, ru, cs, zh-cn, zh-tw):
Add key to all locale files in `src/locales/`, use `t('key')` in components. A message the server writes is also listed
in `scripts/go-shared-data.ts`; run `node scripts/go-shared-data.ts` after changing one.

## Key Files

- `src/constants/env.ts` - Run-time settings from environment variables
- `src/databases/schema.ts` - Database schema
- `src/api/client.ts` - Typed API client
- `server/internal/web/server.go` - The Go server's routes
- `server/internal/config/config.go` - The Go server's settings
- `vite.config.ts` - The browser app's build, and the Go server in development
