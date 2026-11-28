# The game service: runs games on the NAS for devices that can't run them, and sends players the picture and sound.
# See README.md. Built from this folder: docker build <repository>#<commit>:nas-games
FROM golang:1.27-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl-dev libgl-dev libyuv-dev libopus-dev libspeexdsp-dev libx264-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN go build -trimpath -o /host .

# melonDS as the browser has it: libretro's, at the same commit, with the same patch (patches/melonds.patch, a copy of
# src/assets/cores/melonds_libretro.patch). Its fix gives the DS default wireless firmware, without which HeartGold and
# SoulSilver stop at a communication error on loading a save; it also puts the mic and the lid on L3 and L2. Drawn by
# the processor, with no wireless, as in the browser
FROM debian:trixie AS melonds
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates git libgl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY patches/melonds.patch /melonds.patch
RUN git clone https://github.com/libretro/melonDS.git /melonds && cd /melonds \
    && git checkout 4081e8358e66f1ea11879560be6b813dfeaab75a && git apply /melonds.patch \
    && make platform=unix HAVE_OPENGL=0 HAVE_WIFI=0 -j"$(nproc)"

FROM debian:trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl1 libgl1 libegl-mesa0 libgl1-mesa-dri mesa-vulkan-drivers libyuv0 libopus0 libspeexdsp1 libx264-164 \
      ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
# The emulators, and PPSSPP's support files, from libretro's own build server: every one the app plays its consoles
# with
ARG CORES="a5200 desmume desmume2015 fbneo fceumm freechaf gambatte gearboy gearcoleco gearsystem genesis_plus_gx gw \
    mame2003_plus \
    melondsds mednafen_lynx mednafen_ngp mednafen_pce_fast mednafen_vb mednafen_wswan mgba mupen64plus_next nestopia o2em \
    pcsx_rearmed picodrive ppsspp prosystem quicknes snes9x snes9x2002 snes9x2005 snes9x2010 stella2014 tgbdual vba_next"
RUN mkdir -p /cores /system && cd /cores \
    && for core in $CORES; do \
         curl -fsSLO https://buildbot.libretro.com/nightly/linux/x86_64/latest/${core}_libretro.so.zip \
         && unzip -q ${core}_libretro.so.zip && rm ${core}_libretro.so.zip; done \
    && cd /system && curl -fsSLO https://buildbot.libretro.com/assets/system/PPSSPP.zip && unzip -q PPSSPP.zip && rm PPSSPP.zip
# Some are marked as needing an executable stack, which this system's loader refuses (melonDS): a marker their builds
# leave behind rather than a need, so it's taken off
RUN apt-get update && apt-get install -y --no-install-recommends patchelf \
    && for core in /cores/*.so; do patchelf --clear-execstack "$core"; done \
    && apt-get purge -y curl unzip patchelf && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=melonds /melonds/melonds_libretro.so /cores/melonds_libretro.so
COPY --from=build /host /host
ENTRYPOINT ["/host"]
CMD ["serve"]
