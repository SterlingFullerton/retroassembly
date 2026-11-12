import { delay } from 'es-toolkit'
import { isMatch } from 'es-toolkit/compat'
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useLaunchButton } from '../../atoms.ts'
import { useAutosave } from './hooks/use-autosave.ts'
import { useEmulator } from './hooks/use-emulator.ts'
import { useSaveOnHide } from './hooks/use-save-on-hide.ts'

export function GameAnimatePresence() {
  const { emulator, launched, start } = useEmulator()
  // Whether a game is running right now, not when this render happened
  const launchedRef = useRef(launched)
  useEffect(() => {
    launchedRef.current = launched
  }, [launched])
  const animateStyle = { height: '100%', left: 0, top: 0, width: '100%' }
  const [launchButton] = useLaunchButton()
  const rect = launchButton?.getBoundingClientRect()
  const initialStyle = rect ? { height: rect.height, left: rect.left, top: rect.top, width: rect.width } : {}

  useAutosave()
  useSaveOnHide()

  async function handleAnimationComplete(definition: TargetAndTransition) {
    if (isMatch(definition, animateStyle) && emulator) {
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
          exit={{ ...initialStyle, backgroundColor: 'var(--accent-9)', opacity: 0.5 }}
          initial={{ ...initialStyle, backgroundColor: 'var(--accent-9)', opacity: 1 }}
          onAnimationComplete={handleAnimationComplete}
          transition={{ duration: 0.2 }}
        />
      ) : null}
    </AnimatePresence>
  )
}
