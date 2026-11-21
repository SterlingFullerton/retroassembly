# Shader previews

A preview of each shader in the settings, served by the app from this folder. Each is libretro's 64 by 64 test card
drawn through the shader at 8 times its size, with the shader files the app runs (libretro/glsl-shaders at the version
the app pins), as RetroArch draws them.

They're made by `scripts/shader-previews.ts`. Run it again when shaders are added or the pinned version changes:

```sh
node scripts/shader-previews.ts
```

The test card is `docs/image/shader/upscale-test.png` from [libretro/docs](https://github.com/libretro/docs), under the
MIT license, the card libretro's own shader previews show; `original.png` is a copy of it, shown when shaders are off.
The shaders are libretro's, each under its own license.
