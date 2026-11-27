// The frontend's side that Go calls; see frontend.c
#ifndef HOST_FRONTEND_H
#define HOST_FRONTEND_H

#include <stdint.h>

int fe_load(const char *core_path, const char *game_path, const char *system_path, const char *save_path);
void fe_set_option(const char *key, const char *value);
double fe_fps(void);
double fe_aspect(void);
double fe_sample_rate(void);
void fe_run(void);
void fe_reset(void);
#include <stddef.h>
size_t fe_state_size(void);
int fe_save_state(void *out, size_t size);
int fe_load_state(const void *state, size_t size);
void fe_set_pad(int port, uint16_t pressed, int16_t lx, int16_t ly, int16_t rx, int16_t ry);
int fe_take_frame(uint8_t *out, int capacity, int *width, int *height);
int fe_take_sound(int16_t *out, int capacity_frames);
int fe_save_size(void);
void *fe_save_data(void);
void fe_unload(void);

typedef struct video_encoder video_encoder;
video_encoder *ve_new(int width, int height, double fps, int kilobits);
int ve_encode(video_encoder *encoder, uint8_t *i420, int keyframe, int64_t pts, uint8_t **out);
void ve_free(video_encoder *encoder);

typedef struct sound_encoder sound_encoder;
sound_encoder *se_new(double rate);
int se_push(sound_encoder *encoder, const int16_t *samples, int frames, uint8_t *out, int packet_capacity, int *sizes,
            int max_packets);

#endif
