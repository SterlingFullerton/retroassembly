import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Neo Geo Pocket's controls: the d-pad every console shares, dark grey A and B slanted along the arc the thumb makes
// rolling from one to the other, as on the WonderSwan and Lynx, and Option in the top bar beside pause. Beetle Neo Geo Pocket reads A from the RetroPad's B, B from A, and Option from
// Start. Neo Geo Pocket Color games share them.
const pressed = pressedLook(125)
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full text-2xl font-extrabold text-[#e8e8ea] landscape:text-xl')

export function NgpControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Pocket's
  // picture is almost square, so in landscape it leaves more room beside it. Each group hangs off a point with no size
  // at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 160 / 152)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            round,
            'right-27 bottom-19 size-19.5 landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        >
          A
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            round,
            'right-4.5 bottom-29 size-19.5 landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        >
          B
        </VirtualGamepadButton>
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start' title='Option'>
          OPTION
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
