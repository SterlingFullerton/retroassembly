import { delay } from 'es-toolkit'
import { isMatch } from 'es-toolkit/compat'
import { AnimatePresence, motion, type TargetAndTransition, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useLaunchButton } from '../../atoms.ts'
import { useAutosave } from './hooks/use-autosave.ts'
import { useBlackBarsWhilePlaying } from './hooks/use-black-bars-while-playing.ts'
import { useKeepGameSave } from './hooks/use-keep-game-save.ts'
import { useSaveOnHide } from './hooks/use-save-on-hide.ts'

export function GameAnimatePresence() {
  const { emulator, launched, start } = useSession()
  // Whether a game is running right now, not when this render happened
  const launchedRef = useRef(launched)
  useEffect(() => {
    launchedRef.current = launched
  }, [launched])
  const animateStyle = { height: '100%', left: 0, top: 0, width: '100%' }
  const [launchButton] = useLaunchButton()
  const rect = launchButton?.getBoundingClientRect()
  // The game grows out of the button that started it, and shrinks back into it. Where the device asks for less motion
  // it fades in and out where it is instead
  const reducedMotion = useReducedMotion()
  const initialStyle =
    rect && !reducedMotion ? { height: rect.height, left: rect.left, top: rect.top, width: rect.width } : animateStyle

  useAutosave()
  useBlackBarsWhilePlaying()
  useSaveOnHide()
  useKeepGameSave()

  async function handleAnimationComplete(definition: TargetAndTransition) {
    // Coming in, as against going out, which with less motion ends at the same place
    if (definition.opacity === 1 && isMatch(definition, animateStyle) && emulator) {
      document.body.classList.add('overflow-hidden')
      await delay(0)
      await start()
    } else {
      document.body.classList.remove('overflow-hidden')
      // With no game running, an emulator canvas left on the page would only cover it, block clicks and hide the cursor
      if (!launchedRef.current) {
        for (const canvas of document.querySelectorAll('body > canvas#canvas')) {
          canvas.remove()
        }
      }
    }
  }

  return (
    <AnimatePresence>
      {launched ? (
        <motion.div
          animate={{ ...animateStyle, backgroundColor: 'black', opacity: 1 }}
          className='fixed z-1 bg-black'
          exit={{ ...initialStyle, backgroundColor: 'var(--accent-9)', opacity: reducedMotion ? 0 : 0.5 }}
          initial={{
            ...initialStyle,
            backgroundColor: reducedMotion ? 'black' : 'var(--accent-9)',
            opacity: reducedMotion ? 0 : 1,
          }}
          onAnimationComplete={handleAnimationComplete}
          transition={{ duration: 0.2 }}
        />
      ) : null}
    </AnimatePresence>
  )
}
