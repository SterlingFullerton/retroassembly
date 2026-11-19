// The one copy of the versions of the files emulators need from the CDN. Emulator addresses, the offline cache's
// allowlist and the offline downloader all read from here, so they can't disagree

/**
 * RetroArch's official browser build, from libretro's build server. The emulators the app uses are packed from it into
 * public/cores (scripts/retroarch-cores.ts) and served by the app itself
 */
export const officialRetroArch = {
  sha256: '00e17fda8792ee15a9d9ea4fc769e9f937e525c722ae10dabba2c993941f55f4',
  url: 'https://buildbot.libretro.com/stable/1.22.2/emscripten/RetroArch.7z',
  version: '1.22.2',
}

/** Shaders, on GitHub */
export const shadersRepository = {
  repository: 'libretro/glsl-shaders',
  version: '468f67b6f6788e2719d1dd28dfb2c9b7c3db3cc7',
}
