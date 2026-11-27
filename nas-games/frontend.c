// A small libretro frontend for running one game on the NAS with nothing attached: the core draws into an OpenGL
// context on the Radeon with no screen (EGL, surfaceless), each frame is read back and converted for the encoder, and
// the sound is collected as the core makes it. Go drives it a frame at a time; see frontend.h.
#define _GNU_SOURCE
#include "frontend.h"

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <dlfcn.h>
#include <libyuv.h>
#include <opus/opus.h>
#include <speex/speex_resampler.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <x264.h>

#include "libretro.h"

// ---- The core ----

static struct {
  void *handle;
  void (*init)(void);
  void (*deinit)(void);
  void (*set_environment)(retro_environment_t);
  void (*set_video_refresh)(retro_video_refresh_t);
  void (*set_audio_sample)(retro_audio_sample_t);
  void (*set_audio_sample_batch)(retro_audio_sample_batch_t);
  void (*set_input_poll)(retro_input_poll_t);
  void (*set_input_state)(retro_input_state_t);
  void (*get_system_info)(struct retro_system_info *);
  void (*get_system_av_info)(struct retro_system_av_info *);
  void (*set_controller_port_device)(unsigned, unsigned);
  void (*run)(void);
  void (*reset)(void);
  size_t (*serialize_size)(void);
  bool (*serialize)(void *, size_t);
  bool (*unserialize)(const void *, size_t);
  bool (*load_game)(const struct retro_game_info *);
  void (*unload_game)(void);
  void *(*get_memory_data)(unsigned);
  size_t (*get_memory_size)(unsigned);
} core;

static char system_dir[512], save_dir[512];
static enum retro_pixel_format pixel_format = RETRO_PIXEL_FORMAT_0RGB1555;
static struct retro_system_av_info av;

// Core options: the defaults the core declares, and overrides from the host
#define MAX_OPTIONS 512
static struct {
  char key[128];
  char value[128];
} options[MAX_OPTIONS];
static int option_count;

static void set_option(const char *key, const char *value, bool override) {
  for (int i = 0; i < option_count; i++) {
    if (strcmp(options[i].key, key) == 0) {
      if (override) snprintf(options[i].value, sizeof options[i].value, "%s", value);
      return;
    }
  }
  if (option_count == MAX_OPTIONS) return;
  snprintf(options[option_count].key, sizeof options[0].key, "%s", key);
  snprintf(options[option_count].value, sizeof options[0].value, "%s", value);
  option_count++;
}

void fe_set_option(const char *key, const char *value) { set_option(key, value, true); }

static const char *get_option(const char *key) {
  for (int i = 0; i < option_count; i++)
    if (strcmp(options[i].key, key) == 0) return options[i].value;
  return NULL;
}

static void declare_v1(const struct retro_core_option_definition *d) {
  for (; d && d->key; d++) {
    const char *value = d->default_value ? d->default_value : d->values[0].value;
    if (value) set_option(d->key, value, false);
  }
}

static void declare_v2(const struct retro_core_options_v2 *o) {
  for (const struct retro_core_option_v2_definition *d = o ? o->definitions : NULL; d && d->key; d++) {
    const char *value = d->default_value ? d->default_value : d->values[0].value;
    if (value) set_option(d->key, value, false);
  }
}

// ---- Graphics: a context with no screen, and the framebuffer the core draws into ----

static struct retro_hw_render_callback hw;
static bool hw_render;
static EGLDisplay display = EGL_NO_DISPLAY;
static EGLContext context = EGL_NO_CONTEXT;
static GLuint framebuffer, color_texture, depth_buffer;
static unsigned framebuffer_width, framebuffer_height;

static PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers_;
static PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer_;
static PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D_;
static PFNGLGENRENDERBUFFERSPROC glGenRenderbuffers_;
static PFNGLBINDRENDERBUFFERPROC glBindRenderbuffer_;
static PFNGLRENDERBUFFERSTORAGEPROC glRenderbufferStorage_;
static PFNGLFRAMEBUFFERRENDERBUFFERPROC glFramebufferRenderbuffer_;
static PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus_;

static uintptr_t current_framebuffer(void) { return framebuffer; }

static retro_proc_address_t proc_address(const char *name) {
  return (retro_proc_address_t)eglGetProcAddress(name);
}

static bool create_context(void) {
  PFNEGLGETPLATFORMDISPLAYEXTPROC get_display =
      (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
  if (!get_display) return false;
  display = get_display(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
  EGLint major, minor;
  if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor)) return false;
  bool gles = hw.context_type == RETRO_HW_CONTEXT_OPENGLES2 || hw.context_type == RETRO_HW_CONTEXT_OPENGLES3 ||
              hw.context_type == RETRO_HW_CONTEXT_OPENGLES_VERSION;
  eglBindAPI(gles ? EGL_OPENGL_ES_API : EGL_OPENGL_API);
  EGLint config_attributes[] = {EGL_RENDERABLE_TYPE, gles ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig config;
  EGLint found = 0;
  eglChooseConfig(display, config_attributes, &config, 1, &found);
  EGLint context_attributes[16];
  int n = 0;
  if (hw.context_type == RETRO_HW_CONTEXT_OPENGL_CORE) {
    context_attributes[n++] = EGL_CONTEXT_MAJOR_VERSION;
    context_attributes[n++] = hw.version_major ? hw.version_major : 3;
    context_attributes[n++] = EGL_CONTEXT_MINOR_VERSION;
    context_attributes[n++] = hw.version_major ? hw.version_minor : 3;
    context_attributes[n++] = EGL_CONTEXT_OPENGL_PROFILE_MASK;
    context_attributes[n++] = EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT;
  } else if (gles) {
    context_attributes[n++] = EGL_CONTEXT_MAJOR_VERSION;
    context_attributes[n++] = hw.context_type == RETRO_HW_CONTEXT_OPENGLES2 ? 2 : 3;
  }
  context_attributes[n] = EGL_NONE;
  context = eglCreateContext(display, found ? config : EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, context_attributes);
  if (context == EGL_NO_CONTEXT || !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) return false;
  glGenFramebuffers_ = (void *)eglGetProcAddress("glGenFramebuffers");
  glBindFramebuffer_ = (void *)eglGetProcAddress("glBindFramebuffer");
  glFramebufferTexture2D_ = (void *)eglGetProcAddress("glFramebufferTexture2D");
  glGenRenderbuffers_ = (void *)eglGetProcAddress("glGenRenderbuffers");
  glBindRenderbuffer_ = (void *)eglGetProcAddress("glBindRenderbuffer");
  glRenderbufferStorage_ = (void *)eglGetProcAddress("glRenderbufferStorage");
  glFramebufferRenderbuffer_ = (void *)eglGetProcAddress("glFramebufferRenderbuffer");
  glCheckFramebufferStatus_ = (void *)eglGetProcAddress("glCheckFramebufferStatus");
  fprintf(stderr, "[host] GL context: %s, %s\n", glGetString(GL_RENDERER), glGetString(GL_VERSION));
  return true;
}

static bool create_framebuffer(unsigned width, unsigned height) {
  framebuffer_width = width;
  framebuffer_height = height;
  glGenTextures(1, &color_texture);
  glBindTexture(GL_TEXTURE_2D, color_texture);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glGenFramebuffers_(1, &framebuffer);
  glBindFramebuffer_(GL_FRAMEBUFFER, framebuffer);
  glFramebufferTexture2D_(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, color_texture, 0);
  if (hw.depth) {
    glGenRenderbuffers_(1, &depth_buffer);
    glBindRenderbuffer_(GL_RENDERBUFFER, depth_buffer);
    glRenderbufferStorage_(GL_RENDERBUFFER, hw.stencil ? GL_DEPTH24_STENCIL8 : GL_DEPTH_COMPONENT24, width, height);
    glFramebufferRenderbuffer_(GL_FRAMEBUFFER, hw.stencil ? GL_DEPTH_STENCIL_ATTACHMENT : GL_DEPTH_ATTACHMENT,
                               GL_RENDERBUFFER, depth_buffer);
  }
  GLenum status = glCheckFramebufferStatus_(GL_FRAMEBUFFER);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glBindFramebuffer_(GL_FRAMEBUFFER, 0);
  return status == GL_FRAMEBUFFER_COMPLETE;
}

// ---- The picture: each frame as I420, ready for the encoder ----

static uint8_t *rgba;  // read back from the framebuffer
static size_t rgba_size;
static uint8_t *frame;  // I420
static size_t frame_capacity;
static int frame_width, frame_height;
static bool frame_ready;

static void ensure(uint8_t **buffer, size_t *capacity, size_t size) {
  if (*capacity < size) {
    free(*buffer);
    *buffer = malloc(size);
    *capacity = size;
  }
}

static void video_refresh(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (!data || width < 2 || height < 2) return;  // the same frame again: nothing new to send
  int w = width & ~1u, h = height & ~1u;
  ensure(&frame, &frame_capacity, (size_t)w * h * 3 / 2);
  uint8_t *y = frame, *u = frame + w * h, *v = u + w * h / 4;
  if (data == RETRO_HW_FRAME_BUFFER_VALID) {
    ensure(&rgba, &rgba_size, (size_t)w * h * 4);
    glBindFramebuffer_(GL_FRAMEBUFFER, framebuffer);
    glPixelStorei(GL_PACK_ALIGNMENT, 4);
    glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    glBindFramebuffer_(GL_FRAMEBUFFER, 0);
    // Read bottom row first; a negative height turns it the right way up
    ABGRToI420(rgba, w * 4, y, w, u, w / 2, v, w / 2, w, hw.bottom_left_origin ? -h : h);
  } else if (pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
    ARGBToI420(data, pitch, y, w, u, w / 2, v, w / 2, w, h);
  } else if (pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
    RGB565ToI420(data, pitch, y, w, u, w / 2, v, w / 2, w, h);
  } else {
    ARGB1555ToI420(data, pitch, y, w, u, w / 2, v, w / 2, w, h);
  }
  frame_width = w;
  frame_height = h;
  frame_ready = true;
}

int fe_take_frame(uint8_t *out, int capacity, int *width, int *height) {
  if (!frame_ready) return 0;
  int size = frame_width * frame_height * 3 / 2;
  if (size > capacity) return -size;
  memcpy(out, frame, size);
  *width = frame_width;
  *height = frame_height;
  frame_ready = false;
  return size;
}

// ---- Sound, as the core makes it ----

static int16_t *sound;
static size_t sound_frames, sound_capacity;

static size_t audio_batch(const int16_t *data, size_t frames) {
  if (sound_frames + frames > sound_capacity) {
    sound_capacity = (sound_frames + frames) * 2;
    sound = realloc(sound, sound_capacity * 2 * sizeof(int16_t));
  }
  memcpy(sound + sound_frames * 2, data, frames * 2 * sizeof(int16_t));
  sound_frames += frames;
  return frames;
}

static void audio_sample(int16_t left, int16_t right) {
  int16_t pair[2] = {left, right};
  audio_batch(pair, 1);
}

int fe_take_sound(int16_t *out, int capacity_frames) {
  int frames = sound_frames < (size_t)capacity_frames ? (int)sound_frames : capacity_frames;
  memcpy(out, sound, frames * 2 * sizeof(int16_t));
  memmove(sound, sound + frames * 2, (sound_frames - frames) * 2 * sizeof(int16_t));
  sound_frames -= frames;
  return frames;
}

// ---- Controllers: four players' RetroPads, set by the host before each frame ----

static uint16_t buttons[4];
static int16_t axes[4][4];
// The stylus or mouse on the picture, for a DS's touch screen: across the whole picture, -0x7fff to 0x7fff each way
static int16_t pointer_x, pointer_y;
static int pointer_pressed;

void fe_set_pointer(int16_t x, int16_t y, int pressed) {
  pointer_x = x;
  pointer_y = y;
  pointer_pressed = pressed;
}

void fe_set_pad(int port, uint16_t pressed, int16_t lx, int16_t ly, int16_t rx, int16_t ry) {
  if (port < 0 || port > 3) return;
  buttons[port] = pressed;
  axes[port][0] = lx;
  axes[port][1] = ly;
  axes[port][2] = rx;
  axes[port][3] = ry;
}

static void input_poll(void) {}

static int16_t input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port > 3) return 0;
  switch (device & RETRO_DEVICE_MASK) {
    case RETRO_DEVICE_JOYPAD:
      if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)buttons[port];
      return id < 16 ? (buttons[port] >> id) & 1 : 0;
    case RETRO_DEVICE_POINTER:
      if (port != 0 || index != 0) return 0;
      switch (id) {
        case RETRO_DEVICE_ID_POINTER_X: return pointer_x;
        case RETRO_DEVICE_ID_POINTER_Y: return pointer_y;
        case RETRO_DEVICE_ID_POINTER_PRESSED: return pointer_pressed;
        case RETRO_DEVICE_ID_POINTER_COUNT: return pointer_pressed ? 1 : 0;
      }
      return 0;
    case RETRO_DEVICE_ANALOG:
      if (index < 2 && id < 2) return axes[port][index * 2 + id];
      if (index == RETRO_DEVICE_INDEX_ANALOG_BUTTON && id < 16) return ((buttons[port] >> id) & 1) ? 0x7fff : 0;
      return 0;
  }
  return 0;
}

// ---- What the core asks of the frontend ----

static void core_log(enum retro_log_level level, const char *format, ...) {
  if (level < RETRO_LOG_INFO) return;
  va_list args;
  va_start(args, format);
  fprintf(stderr, "[core] ");
  vfprintf(stderr, format, args);
  va_end(args);
}

static bool environment(unsigned command, void *data) {
  switch (command & ~RETRO_ENVIRONMENT_EXPERIMENTAL) {
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      *(bool *)data = true;
      return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY:
      *(const char **)data = system_dir;
      return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *(const char **)data = save_dir;
      return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      pixel_format = *(const enum retro_pixel_format *)data;
      return pixel_format <= RETRO_PIXEL_FORMAT_RGB565;
    case RETRO_ENVIRONMENT_GET_PREFERRED_HW_RENDER:
      // The compatibility profile: PPSSPP's own OpenGL loader fails with a core profile and no screen. Cores that need
      // a core profile ask for one anyway
      *(unsigned *)data = RETRO_HW_CONTEXT_OPENGL;
      return true;
    case RETRO_ENVIRONMENT_SET_HW_RENDER: {
      struct retro_hw_render_callback *callback = data;
      if (callback->context_type == RETRO_HW_CONTEXT_VULKAN || callback->context_type == RETRO_HW_CONTEXT_D3D11 ||
          callback->context_type == RETRO_HW_CONTEXT_NONE)
        return false;
      hw = *callback;
      callback->get_current_framebuffer = current_framebuffer;
      callback->get_proc_address = proc_address;
      hw.get_current_framebuffer = current_framebuffer;
      hw.get_proc_address = proc_address;
      hw_render = create_context();
      return hw_render;
    }
    case RETRO_ENVIRONMENT_SET_HW_SHARED_CONTEXT:
      return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      ((struct retro_log_callback *)data)->log = core_log;
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      struct retro_variable *variable = data;
      variable->value = get_option(variable->key);
      return variable->value != NULL;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *(bool *)data = false;
      return true;
    case RETRO_ENVIRONMENT_SET_VARIABLES:
      for (const struct retro_variable *v = data; v && v->key; v++) {
        // "Description; first|second|third", the first being the default
        const char *values = strchr(v->value, ';');
        if (!values) continue;
        values++;
        while (*values == ' ') values++;
        char value[128];
        size_t length = strcspn(values, "|");
        if (length >= sizeof value) length = sizeof value - 1;
        memcpy(value, values, length);
        value[length] = 0;
        set_option(v->key, value, false);
      }
      return true;
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
      *(unsigned *)data = 2;
      return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
      declare_v1(data);
      return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
      declare_v1(((const struct retro_core_options_intl *)data)->us);
      return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
      declare_v2(data);
      return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
      declare_v2(((const struct retro_core_options_v2_intl *)data)->us);
      return true;
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
      av.geometry = *(const struct retro_game_geometry *)data;
      return true;
    case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
      av = *(const struct retro_system_av_info *)data;
      return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
      return true;
    case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE:
      *(int *)data = 3;
      return true;
    case RETRO_ENVIRONMENT_GET_LANGUAGE:
      *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
      return true;
    case RETRO_ENVIRONMENT_GET_USERNAME:
      *(const char **)data = "Player";
      return true;
    case RETRO_ENVIRONMENT_GET_FASTFORWARDING:
      *(bool *)data = false;
      return true;
    case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK:
    case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:
    case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
    case RETRO_ENVIRONMENT_SET_MESSAGE:
    case RETRO_ENVIRONMENT_SET_MESSAGE_EXT:
    case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
      return true;
  }
  return false;
}

// ---- Starting, running and stopping ----

#define LOAD(name)                                          \
  core.name = dlsym(core.handle, "retro_" #name);           \
  if (!core.name) {                                         \
    fprintf(stderr, "[host] core has no retro_%s\n", #name); \
    return -1;                                              \
  }

static void *game_data;

int fe_load(const char *core_path, const char *game_path, const char *system_path, const char *save_path) {
  snprintf(system_dir, sizeof system_dir, "%s", system_path);
  snprintf(save_dir, sizeof save_dir, "%s", save_path);
  core.handle = dlopen(core_path, RTLD_NOW | RTLD_LOCAL);
  if (!core.handle) {
    fprintf(stderr, "[host] %s\n", dlerror());
    return -1;
  }
  LOAD(init) LOAD(deinit) LOAD(set_environment) LOAD(set_video_refresh) LOAD(set_audio_sample)
  LOAD(set_audio_sample_batch) LOAD(set_input_poll) LOAD(set_input_state) LOAD(get_system_info)
  LOAD(get_system_av_info) LOAD(set_controller_port_device) LOAD(run) LOAD(reset) LOAD(serialize_size) LOAD(serialize) LOAD(unserialize) LOAD(load_game) LOAD(unload_game)
  LOAD(get_memory_data) LOAD(get_memory_size)

  core.set_environment(environment);
  core.set_video_refresh(video_refresh);
  core.set_audio_sample(audio_sample);
  core.set_audio_sample_batch(audio_batch);
  core.set_input_poll(input_poll);
  core.set_input_state(input_state);
  core.init();

  struct retro_system_info info = {0};
  core.get_system_info(&info);
  struct retro_game_info game = {.path = game_path};
  if (!info.need_fullpath) {
    FILE *file = fopen(game_path, "rb");
    if (!file) return -2;
    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    game_data = malloc(size);
    if (fread(game_data, 1, size, file) != (size_t)size) return -2;
    fclose(file);
    game.data = game_data;
    game.size = size;
  }
  if (!core.load_game(&game)) return -3;
  core.get_system_av_info(&av);
  fprintf(stderr, "[host] %s %s: %ux%u (max %ux%u), %.3f fps, %.0f Hz, %s\n", info.library_name,
          info.library_version, av.geometry.base_width, av.geometry.base_height, av.geometry.max_width,
          av.geometry.max_height, av.timing.fps, av.timing.sample_rate, hw_render ? "OpenGL" : "software");
  if (hw_render) {
    if (!create_framebuffer(av.geometry.max_width, av.geometry.max_height)) return -4;
    if (hw.context_reset) hw.context_reset();
  }
  for (unsigned port = 0; port < 4; port++) core.set_controller_port_device(port, RETRO_DEVICE_JOYPAD);
  return 0;
}

double fe_fps(void) { return av.timing.fps; }
// The picture's shape as the core means it to be shown: its own aspect ratio, or its size's
double fe_aspect(void) {
  if (av.geometry.aspect_ratio > 0) return av.geometry.aspect_ratio;
  return av.geometry.base_height ? (double)av.geometry.base_width / av.geometry.base_height : 4.0 / 3.0;
}
double fe_sample_rate(void) { return av.timing.sample_rate; }

void fe_run(void) { core.run(); }
void fe_reset(void) { core.reset(); }

// The game as it is now, to be put back later: a save state
size_t fe_state_size(void) { return core.serialize_size(); }
int fe_save_state(void *out, size_t size) { return core.serialize(out, size); }
int fe_load_state(const void *state, size_t size) { return core.unserialize(state, size); }

// The game's own save (cartridge battery, memory card), to keep and restore
int fe_save_size(void) { return (int)core.get_memory_size(RETRO_MEMORY_SAVE_RAM); }
void *fe_save_data(void) { return core.get_memory_data(RETRO_MEMORY_SAVE_RAM); }

void fe_unload(void) {
  if (hw_render && hw.context_destroy) hw.context_destroy();
  core.unload_game();
  core.deinit();
}

// ---- Encoding the picture: H.264, made to be sent at once ----

struct video_encoder {
  x264_t *x264;
  x264_picture_t picture;
  int width, height;
};

video_encoder *ve_new(int width, int height, double fps, int kilobits) {
  video_encoder *encoder = calloc(1, sizeof *encoder);
  x264_param_t param;
  x264_param_default_preset(&param, "ultrafast", "zerolatency");
  param.i_width = width;
  param.i_height = height;
  param.i_csp = X264_CSP_I420;
  param.i_fps_num = (uint32_t)(fps * 1000);
  param.i_fps_den = 1000;
  param.i_keyint_max = 600;
  param.b_repeat_headers = 1;
  param.b_annexb = 1;
  param.i_threads = 4;
  param.b_sliced_threads = 1;
  param.rc.i_rc_method = X264_RC_CRF;
  param.rc.f_rf_constant = 23;
  param.rc.i_vbv_max_bitrate = kilobits;
  param.rc.i_vbv_buffer_size = kilobits / 10;
  param.i_log_level = X264_LOG_WARNING;
  x264_param_apply_profile(&param, "baseline");
  encoder->x264 = x264_encoder_open(&param);
  if (!encoder->x264) {
    free(encoder);
    return NULL;
  }
  x264_picture_init(&encoder->picture);
  encoder->picture.img.i_csp = X264_CSP_I420;
  encoder->picture.img.i_plane = 3;
  encoder->width = width;
  encoder->height = height;
  return encoder;
}

int ve_encode(video_encoder *encoder, uint8_t *i420, int keyframe, int64_t pts, uint8_t **out) {
  int w = encoder->width, h = encoder->height;
  x264_picture_t *picture = &encoder->picture;
  picture->img.plane[0] = i420;
  picture->img.plane[1] = i420 + w * h;
  picture->img.plane[2] = i420 + w * h + w * h / 4;
  picture->img.i_stride[0] = w;
  picture->img.i_stride[1] = w / 2;
  picture->img.i_stride[2] = w / 2;
  picture->i_type = keyframe ? X264_TYPE_IDR : X264_TYPE_AUTO;
  picture->i_pts = pts;
  x264_nal_t *nals;
  int count;
  x264_picture_t encoded;
  int size = x264_encoder_encode(encoder->x264, &nals, &count, picture, &encoded);
  if (size <= 0) return size;
  *out = nals[0].p_payload;  // all of a frame's units sit together, in order
  return size;
}

void ve_free(video_encoder *encoder) {
  x264_encoder_close(encoder->x264);
  free(encoder);
}

// ---- Encoding the sound: the core's rate to 48 kHz, then Opus in 10 ms packets ----

struct sound_encoder {
  SpeexResamplerState *resampler;
  OpusEncoder *opus;
  int16_t pending[48000 * 2];
  int pending_frames;
};

sound_encoder *se_new(double rate) {
  sound_encoder *encoder = calloc(1, sizeof *encoder);
  int error;
  encoder->resampler = speex_resampler_init_frac(2, (spx_uint32_t)(rate * 100), 4800000, (spx_uint32_t)(rate + 0.5),
                                                 48000, 4, &error);
  encoder->opus = opus_encoder_create(48000, 2, OPUS_APPLICATION_RESTRICTED_LOWDELAY, &error);
  opus_encoder_ctl(encoder->opus, OPUS_SET_BITRATE(96000));
  return encoder;
}

// Takes `frames` of the core's sound; returns how many 10 ms packets are ready, written to `out` one after another,
// each `packet_capacity` bytes apart, with their sizes in `sizes`
int se_push(sound_encoder *encoder, const int16_t *samples, int frames, uint8_t *out, int packet_capacity, int *sizes,
            int max_packets) {
  spx_uint32_t in_frames = frames;
  spx_uint32_t out_frames = 48000 - encoder->pending_frames;
  speex_resampler_process_interleaved_int(encoder->resampler, samples, &in_frames,
                                          encoder->pending + encoder->pending_frames * 2, &out_frames);
  encoder->pending_frames += out_frames;
  int packets = 0;
  int used = 0;
  while (encoder->pending_frames - used >= 480 && packets < max_packets) {
    int size = opus_encode(encoder->opus, encoder->pending + used * 2, 480, out + packets * packet_capacity,
                           packet_capacity);
    if (size > 0) sizes[packets++] = size;
    used += 480;
  }
  memmove(encoder->pending, encoder->pending + used * 2, (encoder->pending_frames - used) * 2 * sizeof(int16_t));
  encoder->pending_frames -= used;
  return packets;
}
