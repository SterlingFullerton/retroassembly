import type { CoreOption } from './types.d.ts'

export const melondsOptions: CoreOption[] = [
  {
    name: 'melonds_screen_layout',
    options: ['Top/Bottom', 'Bottom/Top', 'Left/Right', 'Right/Left', 'Top Only', 'Bottom Only'],
    title: 'Screen layout',
  },
  {
    name: 'melonds_screen_gap',
    options: ['0', '5', '64', '90'],
    title: 'Screen Gap',
  },
  {
    name: 'melonds_audio_interpolation',
    options: ['None', 'Linear', 'Cosine', 'Cubic'],
    title: 'Audio interpolation',
  },
  {
    name: 'melonds_mic_input',
    options: ['Blow Noise', 'White Noise'],
    title: 'Mic button sound',
  },
  {
    defaultOption: 'English',
    name: 'melonds_language',
    options: ['English', 'Japanese', 'French', 'German', 'Italian', 'Spanish'],
    title: 'Firmware language',
  },
]
