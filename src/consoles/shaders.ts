// Each shader's preview, made by scripts/shader-previews.ts and served by the app (see public/assets/shaders/readme.md)
function getShaderThumbnail(shader: string) {
  return `/assets/shaders/${shader}.webp`
}

/** The test card the previews show, as it is with no shader */
export const shaderOffPicture = '/assets/shaders/original.png'

/** The kinds of shader, by the folder each is in */
export const shaderGroups = ['crt', 'handheld', 'smoothing'] as const
export type ShaderGroup = (typeof shaderGroups)[number]

export function getShaderGroup(id: string): ShaderGroup {
  if (id.startsWith('crt/')) {
    return 'crt'
  }
  if (id.startsWith('handheld/')) {
    return 'handheld'
  }
  return 'smoothing'
}

export const shaders = [
  { id: '', name: 'disabled', thumbnail: '' },
  { id: 'anti-aliasing/fxaa', name: 'fxaa', thumbnail: getShaderThumbnail('anti-aliasing/fxaa') },
  { id: 'crt/crt-aperture', name: 'crt-aperture', thumbnail: getShaderThumbnail('crt/crt-aperture') },
  { id: 'crt/crt-cgwg-fast', name: 'crt-cgwg-fast', thumbnail: getShaderThumbnail('crt/crt-cgwg-fast') },
  { id: 'crt/crt-easymode', name: 'crt-easymode', thumbnail: getShaderThumbnail('crt/crt-easymode') },
  {
    id: 'crt/crt-easymode-halation',
    name: 'crt-easymode-halation',
    thumbnail: getShaderThumbnail('crt/crt-easymode-halation'),
  },
  { id: 'crt/crt-geom', name: 'crt-geom', thumbnail: getShaderThumbnail('crt/crt-geom') },
  {
    id: 'crt/crt-interlaced-halation',
    name: 'crt-interlaced-halation',
    thumbnail: getShaderThumbnail('crt/crt-interlaced-halation'),
  },
  { id: 'crt/crt-lottes', name: 'crt-lottes', thumbnail: getShaderThumbnail('crt/crt-lottes') },
  { id: 'crt/crt-mattias', name: 'crt-mattias', thumbnail: getShaderThumbnail('crt/crt-mattias') },
  { id: 'crt/crt-nes-mini', name: 'crt-nes-mini', thumbnail: getShaderThumbnail('crt/crt-nes-mini') },
  { id: 'crt/crt-nobody', name: 'crt-nobody', thumbnail: getShaderThumbnail('crt/crt-nobody') },
  { id: 'crt/crt-pi-vertical', name: 'crt-pi-vertical', thumbnail: getShaderThumbnail('crt/crt-pi-vertical') },
  { id: 'crt/crt-pi', name: 'crt-pi', thumbnail: getShaderThumbnail('crt/crt-pi') },
  { id: 'crt/fakelottes', name: 'fakelottes', thumbnail: getShaderThumbnail('crt/fakelottes') },
  { id: 'crt/smuberstep-glow', name: 'smuberstep-glow', thumbnail: getShaderThumbnail('crt/smuberstep-glow') },
  { id: 'crt/yee64', name: 'yee64', thumbnail: getShaderThumbnail('crt/yee64') },
  {
    id: 'crt/zfast_crt_geo_svideo',
    name: 'zfast_crt_geo_svideo',
    thumbnail: getShaderThumbnail('crt/zfast_crt_geo_svideo'),
  },
  { id: 'crt/zfast_crt_geo', name: 'zfast_crt_geo', thumbnail: getShaderThumbnail('crt/zfast_crt_geo') },
  {
    id: 'crt/zfast_crt_nogeo_svideo',
    name: 'zfast_crt_nogeo_svideo',
    thumbnail: getShaderThumbnail('crt/zfast_crt_nogeo_svideo'),
  },
  { id: 'crt/zfast_crt_nogeo', name: 'zfast_crt_nogeo', thumbnail: getShaderThumbnail('crt/zfast_crt_nogeo') },
  { id: 'crt/zfast-crt', name: 'zfast-crt', thumbnail: getShaderThumbnail('crt/zfast-crt') },
  { id: 'cubic/bicubic', name: 'bicubic', thumbnail: getShaderThumbnail('cubic/bicubic') },
  { id: 'cubic/catmull-rom', name: 'catmull-rom', thumbnail: getShaderThumbnail('cubic/catmull-rom') },
  { id: 'ddt/ddt', name: 'ddt', thumbnail: getShaderThumbnail('ddt/ddt') },
  { id: 'deblur/sedi', name: 'sedi', thumbnail: getShaderThumbnail('deblur/sedi') },
  { id: 'handheld/bevel', name: 'bevel', thumbnail: getShaderThumbnail('handheld/bevel') },
  { id: 'handheld/dot', name: 'dot', thumbnail: getShaderThumbnail('handheld/dot') },
  { id: 'handheld/gba-color', name: 'gba-color', thumbnail: getShaderThumbnail('handheld/gba-color') },
  { id: 'handheld/lcd1x', name: 'lcd1x', thumbnail: getShaderThumbnail('handheld/lcd1x') },
  { id: 'handheld/lcd3x', name: 'lcd3x', thumbnail: getShaderThumbnail('handheld/lcd3x') },
  { id: 'handheld/vba-color', name: 'vba-color', thumbnail: getShaderThumbnail('handheld/vba-color') },
  { id: 'handheld/zfast-lcd', name: 'zfast-lcd', thumbnail: getShaderThumbnail('handheld/zfast-lcd') },
  {
    id: 'interpolation/pixel_art_AA',
    name: 'pixel_art_AA',
    thumbnail: getShaderThumbnail('interpolation/pixel_art_AA'),
  },
  { id: 'sabr/sabr', name: 'sabr', thumbnail: getShaderThumbnail('sabr/sabr') },
  { id: 'xbrz/xbrz-freescale', name: 'xbrz-freescale', thumbnail: getShaderThumbnail('xbrz/xbrz-freescale') },
]

/** Every shader in the order the shader switchers go through them: none first, then each kind's together */
export const orderedShaders = [
  shaders[0],
  ...shaderGroups.flatMap((group) => shaders.filter(({ id }) => id && getShaderGroup(id) === group)),
]

/** The switchers' bar: none alone, then a segment for each kind, where it starts in orderedShaders and how long it is */
export const shaderSegments: { count: number; group?: ShaderGroup; start: number }[] = [
  { count: 1, start: 0 },
  ...shaderGroups.map((group) => ({
    count: orderedShaders.filter(({ id }) => id && getShaderGroup(id) === group).length,
    group,
    start: orderedShaders.findIndex(({ id }) => id && getShaderGroup(id) === group),
  })),
]
