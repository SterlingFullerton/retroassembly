import { Callout } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResolvedPreference } from '#@/constants/preference.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { UpdateButton } from '../update-button.tsx'
import { GamepadInput } from './gamepad-input.tsx'
import { GamepadLiveButtons } from './gamepad-live-buttons.tsx'
import { GamepadTitle } from './gamepad-title.tsx'

interface ButtonGroup {
  buttons: {
    iconClass?: string
    iconNode?: ReactNode
    label?: string
    name: keyof ResolvedPreference['input']['gamepadMappings'][string]
    options?: readonly string[]
    shortcutPart?: 'key' | 'prefix'
    text?: string
  }[]
  className?: string
  type: string
}

export function GamepadInputs() {
  const { t } = useTranslation()
  const { connected, gamepad } = useGamepads()

  const buttonGroups: ButtonGroup[] = [
    {
      buttons: [
        { iconClass: 'icon-[mdi--gamepad-up]', label: t('input.up'), name: 'input_player1_up_btn' },
        { iconClass: 'icon-[mdi--gamepad-down]', label: t('input.down'), name: 'input_player1_down_btn' },
        { iconClass: 'icon-[mdi--gamepad-left]', label: t('input.left'), name: 'input_player1_left_btn' },
        { iconClass: 'icon-[mdi--gamepad-right]', label: t('input.right'), name: 'input_player1_right_btn' },
      ],
      type: 'dpad',
    },
    {
      buttons: [
        { iconClass: 'icon-[mdi--gamepad-circle-left]', label: t('input.buttonY'), name: 'input_player1_y_btn' },
        { iconClass: 'icon-[mdi--gamepad-circle-up]', label: t('input.buttonX'), name: 'input_player1_x_btn' },
        { iconClass: 'icon-[mdi--gamepad-circle-down]', label: t('input.buttonB'), name: 'input_player1_b_btn' },
        { iconClass: 'icon-[mdi--gamepad-circle-right]', label: t('input.buttonA'), name: 'input_player1_a_btn' },
      ],
      type: 'actions',
    },
    {
      buttons: [
        {
          iconNode: <div className='rounded border-2 border-current px-1'>Select</div>,
          name: 'input_player1_select_btn',
        },
        {
          iconNode: <div className='rounded rounded-r-2xl border-2 border-current px-1'>Start</div>,
          name: 'input_player1_start_btn',
        },
      ],
      type: 'functions',
    },
    {
      buttons: [
        {
          iconNode: <div className='rounded rounded-bl-xl border-2 border-current px-2'>L1</div>,
          name: 'input_player1_l1_btn',
        },
        {
          iconNode: <div className='rounded rounded-tl-xl border-2 border-current px-2'>L2</div>,
          name: 'input_player1_l2_btn',
        },
        {
          iconNode: (
            <div className='inline-flex size-7 items-center justify-center rounded-full border-2 border-current'>
              L3
            </div>
          ),
          name: 'input_player1_l3_btn',
        },
      ],
      type: 'l',
    },
    {
      buttons: [
        {
          iconNode: <div className='rounded rounded-br-xl border-2 border-current px-2'>R1</div>,
          name: 'input_player1_r1_btn',
        },
        {
          iconNode: <div className='rounded rounded-tr-xl border-2 border-current px-2'>R2</div>,
          name: 'input_player1_r2_btn',
        },
        {
          iconNode: (
            <div className='inline-flex size-7 items-center justify-center rounded-full border-2 border-current'>
              R3
            </div>
          ),
          name: 'input_player1_r3_btn',
        },
      ],
      type: 'r',
    },
    {
      buttons: [
        {
          iconClass: 'icon-[mdi--pause]',
          name: '$pause',
          options: ['L1 + R1', 'L2 + R2', 'L3 + R3', 'Select + Start', 'Down + Select', 'Down + Start'],
          text: t('emulator.pause'),
        },
      ],
      type: 'pause',
    },
    {
      buttons: [
        {
          iconClass: 'icon-[mdi--thunder]',
          name: '$fast_forward',
          options: ['', 'Select'],
          shortcutPart: 'prefix',
          text: t('emulator.prefix'),
        },
        {
          iconClass: 'icon-[mdi--rewind]',
          name: '$rewind',
          options: ['L1', 'L2'],
          shortcutPart: 'key',
          text: t('emulator.rewind'),
        },
        {
          iconClass: 'icon-[mdi--fast-forward]',
          name: '$fast_forward',
          options: ['R1', 'R2'],
          shortcutPart: 'key',
          text: t('emulator.fastForward'),
        },
      ],
      className: 'mt-2',
      type: 'time',
    },
  ]
  return (
    <>
      <Callout.Root size='1'>
        <Callout.Icon>
          <span className='icon-[mdi--information]' />
        </Callout.Icon>
        <Callout.Text>
          {t('home.youCanVisit')}{' '}
          <a
            className='inline-flex items-center gap-1 underline'
            href='https://hardwaretester.com/gamepad'
            rel='noreferrer noopener'
            target='_blank'
          >
            {t('common.gamepadTester')}
            <span className='icon-[mdi--open-in-new]' />
          </a>{' '}
          {t('home.gamepadTestDescription')}
        </Callout.Text>
      </Callout.Root>

      <div className='mt-2'>
        {gamepad?.id ? (
          <SettingsTitle>
            <div className='flex items-baseline gap-2'>
              <GamepadTitle id={gamepad.id} />
            </div>
          </SettingsTitle>
        ) : null}
        {gamepad?.id ? <GamepadLiveButtons id={gamepad.id} index={gamepad.index} /> : null}

        {connected ? (
          <div className='flex flex-col gap-4 py-2'>
            {buttonGroups.map(({ buttons, type, className }) => (
              <div className={clsx('flex flex-col gap-4 lg:flex-row', className)} key={type}>
                {buttons.map((button) => (
                  <GamepadInput button={button} key={`${button.name}-${button.shortcutPart || 'mapping'}`} />
                ))}
              </div>
            ))}

            <div className='flex justify-end'>
              <UpdateButton preference={{ input: { gamepadMappings: null } }}>
                <span className='icon-[mdi--undo]' />
                {t('emulator.resetToDefaults')}
              </UpdateButton>
            </div>
          </div>
        ) : (
          <div className='flex flex-col items-center justify-center gap-2 py-10 text-center opacity-50 lg:flex-row'>
            <span className='icon-[svg-spinners--180-ring] shrink-0 text-2xl' />
            <span className='lg:text-2xl'>{t('gamepad.pressAnyKey')}</span>
          </div>
        )}
      </div>
    </>
  )
}
