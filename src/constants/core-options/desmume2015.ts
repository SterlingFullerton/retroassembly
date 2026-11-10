import type { CoreOption } from './types.d.ts'

export const desmume2015Options: CoreOption[] = [
  {
    name: 'desmume_frameskip',
    options: ['0', '1', '2', '3', '4', '5'],
    title: 'Frameskip',
  },
  {
    name: 'desmume_screens_layout',
    options: ['top/bottom', 'bottom/top', 'left/right', 'right/left', 'top only', 'bottom only'],
    title: 'Screen layout',
  },
  {
    name: 'desmume_screens_gap',
    options: ['0', '5', '64', '90'],
    title: 'Screen Gap',
  },
  {
    name: 'desmume_internal_resolution',
    options: ['256x192', '512x384', '768x576', '1024x768'],
    title: 'Internal resolution (restart)',
  },
  {
    name: 'desmume_firmware_language',
    options: ['Auto', 'English', 'Japanese', 'French', 'German', 'Italian', 'Spanish'],
    title: 'Firmware language',
  },
]
