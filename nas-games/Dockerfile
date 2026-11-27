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

FROM debian:trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl1 libgl1 libegl-mesa0 libgl1-mesa-dri mesa-vulkan-drivers libyuv0 libopus0 libspeexdsp1 libx264-164 \
      ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
# The emulators, and PPSSPP's support files, from libretro's own build server
RUN mkdir -p /cores /system && cd /cores \
    && for core in mupen64plus_next ppsspp; do \
         curl -fsSLO https://buildbot.libretro.com/nightly/linux/x86_64/latest/${core}_libretro.so.zip \
         && unzip -q ${core}_libretro.so.zip && rm ${core}_libretro.so.zip; done \
    && cd /system && curl -fsSLO https://buildbot.libretro.com/assets/system/PPSSPP.zip && unzip -q PPSSPP.zip && rm PPSSPP.zip \
    && apt-get purge -y curl unzip && apt-get autoremove -y
COPY --from=build /host /host
ENTRYPOINT ["/host"]
CMD ["serve"]
