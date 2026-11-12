import desmume2015 from '#@/assets/cores/desmume2015_libretro.zip?url'

// Addresses of the cores shipped with the app. The build names each file after a fingerprint of its contents, so a
// browser can keep it for good and still pick up a new build of it at its new address
export const bundledCoreUrls: Partial<Record<string, string>> = { desmume2015 }
