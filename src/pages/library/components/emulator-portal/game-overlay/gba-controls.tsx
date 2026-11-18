import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Game Boy Advance's controls drawn like its own buttons: the d-pad every console shares, pale grey A and B slanted with A
// higher, pale grey L and R shoulders, and Select and Start in the top bar beside pause. mGBA and VBA Next read the RetroPad's buttons as the GBA's.
const pressed = pressedLook(90)
const pale = 'radial-gradient(circle at 40% 30%, #ffffff, #d6d6dc 60%, #9a9aa2)'
const paleBar = 'linear-gradient(#e6e6ea, #a8a8b0)'

const shoulder = twMerge(
  pressed,
  'absolute bottom-[262px] h-7.5 w-27.5 rounded-t-[15px] rounded-b-lg text-sm font-extrabold text-[#3a3a40] shadow-[0_2px_4px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[290px] landscape:w-25',
)
const face = twMerge(
  pressed,
  'absolute size-18 rounded-full text-2xl font-extrabold text-[#3a3a40] shadow-[0_3px_4px_#000a,inset_0_-3px_0_#0002] landscape:size-13.5 landscape:text-lg',
)

export function GbaControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 120 points wide; on smaller screens they shrink towards their corner. The GBA's
  // picture is 3:2, wider than the other consoles', so in landscape it leaves less room beside it. Each group hangs off
  // a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 3 / 2)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(shoulder, 'left-4 landscape:left-3')}
          style={{ background: paleBar }}
          title='L'
        >
          L
        </VirtualGamepadButton>
        {/* The d-pad */}
        <DPad className='absolute bottom-19 left-5.5 size-35 landscape:bottom-22.5 landscape:left-3 landscape:size-27' />
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(shoulder, 'right-4 landscape:right-3')}
          style={{ background: paleBar }}
          title='R'
        >
          R
        </VirtualGamepadButton>
        {/* B and A, slanted with A higher, as on the GBA */}
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(face, 'right-25 bottom-20 landscape:right-15.5 landscape:bottom-27.5')}
          group='face'
          style={{ background: pale }}
          title='B'
        >
          B
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(face, 'right-4.5 bottom-29 landscape:right-2.5 landscape:bottom-35')}
          group='face'
          style={{ background: pale }}
          title='A'
        >
          A
        </VirtualGamepadButton>
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
