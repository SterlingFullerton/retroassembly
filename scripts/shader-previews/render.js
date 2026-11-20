// Runs a RetroArch GLSL shader preset (.glslp) on a picture with WebGL 2, as RetroArch's GL driver does, in the page
// scripts/shader-previews.ts opens. Files are fetched from the page's own origin, which the script serves.

;(() => {
  const mvp = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, -1, -1, 0, 1])

  function parsePreset(text) {
    const values = {}
    for (const line of text.split('\n')) {
      const match = line.replace(/#.*$/u, '').match(/^\s*(?<name>[\w.]+)\s*=\s*"?(?<value>[^"]*?)"?\s*$/u)
      if (match?.groups) {
        values[match.groups.name] = match.groups.value
      }
    }
    return values
  }

  function parameterDefaults(source) {
    const defaults = {}
    for (const { groups } of source.matchAll(/#pragma parameter\s+(?<name>\w+)\s+"[^"]*"\s+(?<value>[-\d.eE+]+)/gu)) {
      defaults[groups.name] = Number(groups.value)
    }
    return defaults
  }

  // As RetroArch compiles a shader for OpenGL ES: its own #version replaced, the stage and PARAMETER_UNIFORM defined, and a
  // default precision for the shaders that only set one on desktop GL
  function compile(gl, { source, stage, type, version }) {
    const body = source.replace(/^\s*#version.*$/mu, '')
    const shader = gl.createShader(type)
    gl.shaderSource(
      shader,
      `#version ${version}\n#define ${stage}\n#define PARAMETER_UNIFORM\nprecision highp float;\nprecision highp int;\n${body}`,
    )
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`${stage} (GLSL ES ${version}): ${gl.getShaderInfoLog(shader)}`)
    }
    return shader
  }

  // GLSL ES 3.00 first, as RetroArch uses with GLES 3; the older shaders that only work as GLSL ES 1.00 as that
  function program(gl, source) {
    const errors = []
    for (const version of ['300 es', '100']) {
      try {
        const result = gl.createProgram()
        gl.attachShader(result, compile(gl, { source, stage: 'VERTEX', type: gl.VERTEX_SHADER, version }))
        gl.attachShader(result, compile(gl, { source, stage: 'FRAGMENT', type: gl.FRAGMENT_SHADER, version }))
        gl.bindAttribLocation(result, 0, 'VertexCoord')
        gl.linkProgram(result)
        if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(result))
        }
        return result
      } catch (error) {
        errors.push(error.message)
      }
    }
    throw new Error(errors.join('\n'))
  }

  function texture(gl, [width, height], format) {
    const result = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, result)
    const formats = {
      float: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
      rgba: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
      srgb: [gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE],
    }
    const [internal, layout, type] = formats[format]
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, layout, type, null)
    return result
  }

  function sampling(gl, handle, { linear, mipmap }) {
    gl.bindTexture(gl.TEXTURE_2D, handle)
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D)
    }
    const minify = {
      'linear,': gl.LINEAR,
      'linear,mipmap': gl.LINEAR_MIPMAP_LINEAR,
      'nearest,': gl.NEAREST,
      'nearest,mipmap': gl.NEAREST_MIPMAP_NEAREST,
    }[`${linear ? 'linear' : 'nearest'},${mipmap ? 'mipmap' : ''}`]
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minify)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  function passSize(preset, index, { input, last, viewport }) {
    function axis(name, inputSize, viewportSize) {
      const type = preset[`scale_type_${name}${index}`] ?? preset[`scale_type${index}`]
      const scale = Number(preset[`scale_${name}${index}`] ?? preset[`scale${index}`] ?? 1)
      if (!type) {
        return last ? viewportSize : inputSize
      }
      if (type === 'viewport') {
        return Math.round(viewportSize * scale)
      }
      if (type === 'absolute') {
        return Math.round(scale)
      }
      return Math.round(inputSize * scale)
    }
    return [axis('x', input[0], viewport[0]), axis('y', input[1], viewport[1])]
  }

  // Draws the picture through the preset onto the canvas, at the canvas's size
  async function render(canvas, presetPath, picture) {
    // Opaque, as RetroArch's screen is: some shaders leave alpha at 0, which it never shows
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
    gl.getExtension('EXT_color_buffer_float')
    const folder = presetPath.slice(0, presetPath.lastIndexOf('/') + 1)
    const presetResponse = await fetch(presetPath)
    const preset = parsePreset(await presetResponse.text())
    const count = Number(preset.shaders)
    const viewport = [canvas.width, canvas.height]

    // The picture, already flipped (see renderPreset), so every pass reads it the same way up, as in RetroArch
    const original = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, original)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, picture)
    const originalSize = [picture.width, picture.height]

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1]), gl.STATIC_DRAW)
    const coords = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, coords)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]), gl.STATIC_DRAW)
    const white = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, white)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(16).fill(1), gl.STATIC_DRAW)

    // Each pass's output: its texture and size, by index, and by its alias
    const outputs = []
    const aliases = {}
    let input = { size: originalSize, texture: original }
    for (let index = 0; index < count; index += 1) {
      const last = index === count - 1
      const sourceResponse = await fetch(folder + preset[`shader${index}`])
      const source = await sourceResponse.text()
      const shader = program(gl, source)
      gl.useProgram(shader)
      const size = passSize(preset, index, { input: input.size, last, viewport })
      const toScreen = last && size[0] === viewport[0] && size[1] === viewport[1]
      let output = null
      if (toScreen) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      } else {
        let format = 'rgba'
        if (preset[`float_framebuffer${index}`] === 'true') {
          format = 'float'
        } else if (preset[`srgb_framebuffer${index}`] === 'true') {
          format = 'srgb'
        }
        output = texture(gl, size, format)
        const target = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, target)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0)
      }
      gl.viewport(0, 0, size[0], size[1])
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      for (const [name, buffer, components] of [
        ['VertexCoord', quad, 4],
        ['TexCoord', coords, 4],
        ['COLOR', white, 4],
      ]) {
        const location = gl.getAttribLocation(shader, name)
        if (location >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          gl.enableVertexAttribArray(location)
          gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0)
        }
      }
      // Every other picture a pass can read has its own TexCoord, the same quad here as every texture is its exact size
      const originalPicture = { size: originalSize, texture: original }
      const textures = [
        ['', input, true],
        // The frames before this one are the same picture here
        ...['Orig', 'Prev', 'Prev1', 'Prev2', 'Prev3', 'Prev4', 'Prev5', 'Prev6'].map((name) => [
          name,
          originalPicture,
        ]),
        ...outputs.flatMap((each, i) => [
          [`Pass${i + 1}`, each],
          [`PassPrev${index - i}`, each],
        ]),
        ...Object.entries(aliases),
      ]
      let unit = 0
      for (const [prefix, picture, isInput] of textures) {
        const name = prefix ? `${prefix}Texture` : 'Texture'
        const location = gl.getUniformLocation(shader, name)
        // A shader may read a picture's size without the picture, as dot does the original's
        if (location !== null || isInput) {
          gl.activeTexture(gl.TEXTURE0 + unit)
          sampling(gl, picture.texture, {
            linear: isInput ? preset[`filter_linear${index}`] === 'true' : false,
            mipmap: isInput && preset[`mipmap_input${index}`] === 'true',
          })
          gl.uniform1i(location, unit)
          unit += 1
        }
        for (const [suffix, value] of [
          ['TextureSize', picture.size],
          ['InputSize', picture.size],
        ]) {
          const sizeLocation = gl.getUniformLocation(shader, `${prefix}${suffix}`)
          if (sizeLocation) {
            gl.uniform2f(sizeLocation, value[0], value[1])
          }
        }
        const coordLocation = prefix ? gl.getAttribLocation(shader, `${prefix}TexCoord`) : -1
        if (coordLocation >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, coords)
          gl.enableVertexAttribArray(coordLocation)
          gl.vertexAttribPointer(coordLocation, 4, gl.FLOAT, false, 0, 0)
        }
      }
      const uniforms = {
        FrameCount: ['1i', 0],
        FrameDirection: ['1i', 1],
        OutputSize: ['2f', size],
      }
      for (const [name, [type, value]] of Object.entries(uniforms)) {
        const location = gl.getUniformLocation(shader, name)
        if (location && type === '1i') {
          gl.uniform1i(location, value)
        } else if (location) {
          gl.uniform2f(location, value[0], value[1])
        }
      }
      const matrix = gl.getUniformLocation(shader, 'MVPMatrix')
      if (matrix) {
        gl.uniformMatrix4fv(matrix, false, mvp)
      }
      const parameters = { ...parameterDefaults(source) }
      for (const [name, value] of Object.entries(preset)) {
        if (name in parameters) {
          parameters[name] = Number(value)
        }
      }
      for (const [name, value] of Object.entries(parameters)) {
        const location = gl.getUniformLocation(shader, name)
        if (location) {
          gl.uniform1f(location, value)
        }
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (!toScreen) {
        const result = { size, texture: output }
        outputs.push(result)
        if (preset[`alias${index}`]) {
          aliases[preset[`alias${index}`]] = result
        }
        input = result
      }
    }

    // A last pass at another size is drawn onto the screen as it is, stretched with nearest filtering
    if (outputs.length === count) {
      const blit = gl.createFramebuffer()
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, blit)
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, input.texture, 0)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.blitFramebuffer(
        0,
        0,
        input.size[0],
        input.size[1],
        0,
        0,
        viewport[0],
        viewport[1],
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      )
    }
    const error = gl.getError()
    if (error) {
      throw new Error(`WebGL error ${error}`)
    }
  }

  // The preset's preview, size pixels square, as a PNG data URL
  globalThis.renderPreset = async (presetPath, picturePath, size) => {
    const pictureResponse = await fetch(picturePath)
    // Flipped as it's decoded: WebGL's own flip doesn't apply to an ImageBitmap
    const picture = await createImageBitmap(await pictureResponse.blob(), { imageOrientation: 'flipY' })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    await render(canvas, presetPath, picture)
    return canvas.toDataURL('image/png')
  }
})()
