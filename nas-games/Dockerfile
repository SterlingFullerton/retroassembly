# The game service: runs games on the NAS for devices that can't run them, and sends players the picture and sound.
# See README.md. Built from this folder: docker build <repository>#<commit>:nas-games
#
# What it's built from is pinned, so building a commit again gives the same service: the base images by digest, Debian's
# packages from Debian's snapshot archive at a fixed date, and melonDS and melonDS DS, with everything melonDS DS fetches,
# at fixed commits. The other emulators come from libretro's nightly builds, which have no fixed addresses, so the
# fingerprint of each one fetched is kept in the image, in /cores/SHA256SUMS, to tell one build's from another's
ARG GO_IMAGE=golang:1.27.4-trixie@sha256:430985542100b871e108ccc00e8dcc5eef08ca14ee5825e98ebf563d8ffec4ee
ARG DEBIAN_IMAGE=debian:trixie-20261123@sha256:3cda3ca472ce45507a5109c6a3907093e24d9ae67d55954c9a07a45665dafba2
ARG DEBIAN_SNAPSHOT=20261123T000000Z

# Debian, with its packages as they were at DEBIAN_SNAPSHOT. The snapshot archive's lists are old by design, so apt is
# told not to refuse them for that
FROM ${DEBIAN_IMAGE} AS debian
ARG DEBIAN_SNAPSHOT
RUN sed -Ei "s|http://deb.debian.org/(debian(-security)?)\$|http://snapshot.debian.org/archive/\1/${DEBIAN_SNAPSHOT}|" \
      /etc/apt/sources.list.d/debian.sources \
    && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/snapshot

FROM ${GO_IMAGE} AS build
ARG DEBIAN_SNAPSHOT
RUN sed -Ei "s|http://deb.debian.org/(debian(-security)?)\$|http://snapshot.debian.org/archive/\1/${DEBIAN_SNAPSHOT}|" \
      /etc/apt/sources.list.d/debian.sources \
    && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/snapshot \
    && apt-get update && apt-get install -y --no-install-recommends \
      libegl-dev libgl-dev libyuv-dev libopus-dev libspeexdsp-dev libx264-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN go build -trimpath -o /host .

# The service's checks and tests, which need the libraries above: CI builds this stage (docker build --target test)
FROM build AS test
RUN test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...

# melonDS as the browser has it: libretro's, at the same commit, with the same patch (patches/melonds.patch, a copy of
# src/assets/cores/melonds_libretro.patch). Its fix gives the DS default wireless firmware, without which HeartGold and
# SoulSilver stop at a communication error on loading a save; it also puts the mic and the lid on L3 and L2. Drawn by
# the processor, with no wireless, as in the browser
FROM debian AS melonds
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates git libgl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY patches/melonds.patch /melonds.patch
RUN git clone https://github.com/libretro/melonDS.git /melonds && cd /melonds \
    && git checkout 4081e8358e66f1ea11879560be6b813dfeaab75a && git apply /melonds.patch \
    && make platform=unix HAVE_OPENGL=0 HAVE_WIFI=0 -j"$(nproc)"

# melonDS DS, the build of melonDS that links two consoles as by local wireless: built from its 1.4.0 source with a patch
# (patches/melondsds.patch) that handles its wireless packets as melonDS's own multiplayer on one machine does, replies
# kept apart from other packets and waits timed by the clock, so two linked consoles don't keep waiting on each other.
# Its 1.4.0 is taken by commit rather than by tag, and what it fetches as it's configured (its own melonDS, from a
# branch, and the libraries it needs, by tag or short commit) by full commit, each the one 1.4.0 names as of this
# writing; the patch depends on that melonDS's wireless code
FROM debian AS melondsds
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates cmake git pkg-config \
      libgl-dev libegl-dev python3 \
    && rm -rf /var/lib/apt/lists/*
COPY patches/melondsds.patch /melondsds.patch
RUN git init -q /melondsds && cd /melondsds \
    && git fetch -q --depth 1 https://github.com/JesseTG/melonds-ds.git f394adbacb5722ee97c1b37c8064da9a25818310 \
    && git checkout -q FETCH_HEAD && git apply /melondsds.patch \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release \
      -DMELONDS_REPOSITORY_TAG=16f127dbb587a73371827ce79689c5d237c4b59b \
      -DLIBRETRO_COMMON_REPOSITORY_TAG=fa8a1b572a444fcb552007019f8caf68281108aa \
      -DEMBED_BINARIES_REPOSITORY_TAG=078b62beba97e8192c99bfb16d5e17220cfc7598 \
      -DGLM_REPOSITORY_TAG=6f14f4792a0cde5d0cf2c910506724d61cb95834 \
      -DLIBSLIRP_REPOSITORY_TAG=e61dbd459c8c06607b3a84694489427e8ec60f17 \
      -DPNTR_REPOSITORY_TAG=a47fe167703b0ac3bfad00785b20b0dce6712509 \
      -DFMT_REPOSITORY_TAG=1be298e1bd68957e4cd352e1f676f00e07dcfb57 \
      -DYAMC_REPOSITORY_TAG=4e015a7e8eb0d61c34e6928676c8c78881a72d73 \
      -DSPAN_LITE_REPOSITORY_TAG=f63fe2974943b5f555b928b10d910e457fbb93d4 \
      -DDATE_REPOSITORY_TAG=179a6b921ccd6179b5b04dce812a89f71a51b4df \
      -DZLIB_REPOSITORY_TAG=da607da739fa6047df13e66a2af6b8bec7c2a498 \
    && cmake --build build -j"$(nproc)" \
    && cp "$(find build -name melondsds_libretro.so | head -1)" /melondsds_libretro.so

FROM debian
RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl1 libgl1 libegl-mesa0 libgl1-mesa-dri mesa-vulkan-drivers libyuv0 libopus0 libspeexdsp1 libx264-164 \
      ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
# The emulators, and PPSSPP's support files, from libretro's own build server: every one the app plays its consoles
# with. A download that fails, after a few tries, fails the build, rather than leaving that console with no emulator
ARG CORES="a5200 desmume desmume2015 fbneo fceumm freechaf gambatte gearboy gearcoleco gearsystem genesis_plus_gx gw \
    mame2003_plus \
    mednafen_lynx mednafen_ngp mednafen_pce_fast mednafen_vb mednafen_wswan mgba mupen64plus_next nestopia o2em \
    pcsx_rearmed picodrive ppsspp prosystem quicknes snes9x snes9x2002 snes9x2005 snes9x2010 stella2014 tgbdual vba_next"
RUN set -eu; mkdir -p /cores /system; cd /cores; \
    for core in $CORES; do \
      curl -fsSLO --retry 3 https://buildbot.libretro.com/nightly/linux/x86_64/latest/${core}_libretro.so.zip; \
      unzip -q ${core}_libretro.so.zip; \
      test -f ${core}_libretro.so || { echo "${core}_libretro.so.zip has no ${core}_libretro.so"; exit 1; }; \
    done; \
    curl -fsSLO --retry 3 https://buildbot.libretro.com/assets/system/PPSSPP.zip; \
    unzip -q PPSSPP.zip -d /system; \
    sha256sum *.zip > SHA256SUMS; \
    rm *.zip
COPY --from=melonds /melonds/melonds_libretro.so /cores/melonds_libretro.so
COPY --from=melondsds /melondsds_libretro.so /cores/melondsds_libretro.so
# Some are marked as needing an executable stack, which this system's loader refuses (melonDS): a marker their builds
# leave behind rather than a need, so it's taken off, from the ones built here as well as the downloaded ones
RUN set -eu; apt-get update; apt-get install -y --no-install-recommends patchelf; \
    for core in /cores/*.so; do patchelf --clear-execstack "$core"; done; \
    apt-get purge -y curl unzip patchelf; apt-get autoremove -y; rm -rf /var/lib/apt/lists/*
COPY --from=build /host /host
ENTRYPOINT ["/host"]
CMD ["serve"]
