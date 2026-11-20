ARG BUILD_IMAGE=node:26.12.1-slim
ARG GO_IMAGE=golang:1.27.4-alpine
ARG PROD_IMAGE=gcr.io/distroless/static-debian12
ARG PNPM_VERSION=12.11.2

FROM ${BUILD_IMAGE} AS base
WORKDIR /app
ARG PNPM_VERSION
RUN npm i -g pnpm@${PNPM_VERSION}

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch

# RetroArch's official browser emulators, downloaded once from libretro's build server and packed for the app to serve
# (scripts/retroarch-cores.ts). This layer only reruns when the script or the emulator list changes
FROM base AS retroarch-cores
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libarchive-tools \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/retroarch-cores.ts scripts/
COPY src/consoles src/consoles
COPY src/input src/input
RUN node scripts/retroarch-cores.ts /cores

# The game info database the app looks games up in (scripts/game-info.ts), built from libretro's and LaunchBox's own
# databases. Each build asks both servers whether their files changed, and rebuilds it with their latest data if so
FROM deps AS game-info
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libarchive-tools \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i --offline --frozen-lockfile --ignore-scripts
ADD https://buildbot.libretro.com/assets/frontend/database-rdb.zip /inputs/database-rdb.zip
ADD https://gamesdb.launchbox-app.com/Metadata.zip /inputs/Metadata.zip
COPY scripts/game-info.ts scripts/
COPY scripts/game-info scripts/game-info
RUN node scripts/game-info.ts /inputs/database-rdb.zip /inputs/Metadata.zip /game-info/game-info.sqlite

# The browser app, which the server sends as it is
FROM deps AS builder
ARG RETROASSEMBLY_BUILD_TIME_VITE_VERSION
ENV RETROASSEMBLY_BUILD_TIME_VITE_VERSION=$RETROASSEMBLY_BUILD_TIME_VITE_VERSION
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=true
COPY . .
COPY --from=retroarch-cores /cores public/cores
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i
RUN node --run=build:client

# The server (server/): one static binary, built on the build machine for each platform the image is for
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS server
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags nodynamic -trimpath -ldflags="-s -w" -o /retroassembly ./cmd/retroassembly

FROM ${PROD_IMAGE} AS production
WORKDIR /app
COPY --from=server /retroassembly ./retroassembly
COPY --from=builder /app/dist/client ./dist/client
COPY --from=builder /app/src/databases/migrations ./src/databases/migrations
COPY --from=game-info /game-info ./game-info

VOLUME ["/app/data"]
EXPOSE 8000
CMD ["/app/retroassembly"]
