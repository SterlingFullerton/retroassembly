import { Kbd } from '@radix-ui/themes'
import { capitalize, uniq } from 'es-toolkit'
import { useTranslation } from 'react-i18next'
import { useConfirmButtonStyle } from '../../hooks/use-confirm-button-style.ts'
import { useGamepads } from '../../hooks/use-gamepads.ts'
import { useInputMapping } from '../../hooks/use-input-mapping.ts'
import { usePreference } from '../../hooks/use-preference.ts'
import { LayoutMenu } from './layout-menu/layout-menu.tsx'
import { UploadBadge } from './upload-badge.tsx'

const rightButtonIcon = <span className='icon-[mdi--gamepad-circle-right] text-white' />
const downButtonIcon = <span className='icon-[mdi--gamepad-circle-down] text-white' />

export function StatusBar() {
  const { t } = useTranslation()
  const { connected } = useGamepads()
  const { keyboard: keyboardMapping } = useInputMapping()
  const { preference } = usePreference()

  const confirmButtonStyle = useConfirmButtonStyle()
  const keyboarMappingConfirm = { nintendo: keyboardMapping.input_player1_a, xbox: keyboardMapping.input_player1_b }[
    confirmButtonStyle
  ]
  const keyboarMappingCancel = { nintendo: keyboardMapping.input_player1_b, xbox: keyboardMapping.input_player1_a }[
    confirmButtonStyle
  ]

  return (
    <div className='fixed right-0 bottom-0 left-72 z-11 hidden h-12 items-center justify-end gap-4 bg-(--accent-9) pr-8 text-sm font-medium text-white lg:flex'>
      <UploadBadge className='mr-auto ml-8 flex items-center gap-2 text-white' />
      {connected ? (
        <>
          <span className='flex items-center gap-2'>
            <span className='icon-[mdi--microsoft-xbox-gamepad] text-white' />
            {t('common.connected')}
          </span>
          <span className='flex items-center gap-2'>
            <span className='icon-[mdi--gamepad] text-white' />
            {t('common.move')}
          </span>
          <span className='flex items-center gap-2'>
            <div className='scale-80 rounded border-2 border-current px-1 text-xs'>L R</div>
            {t('nav.jump')}
          </span>
          <span className='flex items-center gap-2'>
            {{ nintendo: rightButtonIcon, xbox: downButtonIcon }[confirmButtonStyle]}
            {t('common.confirm')}
          </span>
          <span className='flex items-center gap-2'>
            {{ nintendo: downButtonIcon, xbox: rightButtonIcon }[confirmButtonStyle]}
            {t('common.back')}
          </span>
          <span className='flex items-center gap-2'>
            <div className='scale-80 rounded border-2 border-current px-1 text-xs'>Select</div>
            {t('common.search')}
          </span>
        </>
      ) : (
        <>
          {/* Browsers only report a controller once one of its buttons is pressed on the page. The hint is left out below
              1280 points, where it would crowd the keys */}
          <span className='hidden items-center gap-2 text-white/90 xl:flex'>
            <span className='icon-[mdi--google-gamepad]' />
            {t('gamepad.pressToUse')}
          </span>
          <span className='flex items-center gap-2'>
            <Kbd className='text-xs! text-(--accent-9)!' size='1'>
              {[
                keyboardMapping.input_player1_up,
                keyboardMapping.input_player1_down,
                keyboardMapping.input_player1_left,
                keyboardMapping.input_player1_right,
              ]
                .filter(Boolean)
                .map((key) => ({ down: '↓', left: '←', right: '→', up: '↑' })[key] || capitalize(key))
                .join(' ')}
            </Kbd>
            {t('common.move')}
          </span>

          <span className='flex items-center gap-2'>
            <Kbd className='text-xs! text-(--accent-9)!' size='1'>
              Shift ↑ ↓ ← →
            </Kbd>
            {t('nav.jump')}
          </span>

          {keyboarMappingConfirm ? (
            <span className='flex items-center gap-2'>
              <Kbd className='text-xs! text-(--accent-9)!' size='1'>
                {uniq(['Enter', capitalize(keyboarMappingConfirm)]).join(' / ')}
              </Kbd>
              {t('common.confirm')}
            </span>
          ) : null}

          {keyboarMappingCancel ? (
            <span className='flex items-center gap-2'>
              <Kbd className='text-xs! text-(--accent-9)!' size='1'>
                {capitalize(keyboarMappingCancel)}
              </Kbd>
              {t('common.back')}
            </span>
          ) : null}
        </>
      )}

      {preference.ui.showSidebar ? null : <LayoutMenu />}
    </div>
  )
}
