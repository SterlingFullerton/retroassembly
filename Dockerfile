ARG BUILD_IMAGE=node:26.12.1-slim
ARG PROD_IMAGE=node:26.12.1-alpine
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

FROM deps AS builder
ARG RETROASSEMBLY_BUILD_TIME_VITE_VERSION
ENV RETROASSEMBLY_BUILD_TIME_VITE_VERSION=$RETROASSEMBLY_BUILD_TIME_VITE_VERSION
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=true
COPY . .
COPY --from=retroarch-cores /cores public/cores
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i
RUN node --run=build

FROM ${PROD_IMAGE} AS deps-production
ARG PNPM_VERSION
RUN npm i -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i --prod

FROM ${PROD_IMAGE} AS production
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/databases ./src/databases
COPY --from=builder /app/dist ./dist
COPY --from=deps-production /app/node_modules ./node_modules

VOLUME ["/app/data"]
EXPOSE 8000
CMD ["node", "--run=start"]
