import { clsx } from 'clsx'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applyVolume, getVolume, type Volume } from '#@/pages/library/utils/audio-contexts.ts'

// The volume, under the pause menu's buttons and in their style: a speaker that mutes, a slider and how loud it is.
// With a gamepad or the keyboard the slider is one stop, like a button, with the focus drawn around the whole row:
// left and right turn it down or up by 10, and confirming mutes. With a mouse or a finger, the speaker mutes and the
// slider sets it.
export function GameOverlayVolume() {
  const { t } = useTranslation()
  const [volume, setVolume] = useState(getVolume)
  const slider = useRef<HTMLInputElement>(null)

  function update(newVolume: Volume) {
    applyVolume(newVolume)
    setVolume(getVolume())
  }

  function toggleMuted() {
    update({ ...volume, muted: !volume.muted })
  }

  // Confirming with a gamepad or the keyboard clicks the slider without a pointer; a pointer's clicks only move it
  function handleSliderClick(event: MouseEvent<HTMLInputElement>) {
    if (event.detail === 0) {
      toggleMuted()
    }
  }

  useEffect(() => {
    const element = slider.current
    if (!element) {
      return
    }
    function handleAdjust(event: Event) {
      const step = event instanceof CustomEvent && event.detail === 'left' ? -10 : 10
      applyVolume({ level: Math.round((getVolume().level + step) / 10) * 10, muted: false })
      setVolume(getVolume())
    }
    element.addEventListener('sn:adjust', handleAdjust)
    return () => element.removeEventListener('sn:adjust', handleAdjust)
  }, [])

  const filled = `${volume.level}%`
  const muteLabel = volume.muted ? t('emulator.unmute') : t('emulator.mute')

  return (
    <div
      className={clsx(
        'flex h-12 w-full shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 pr-5 pl-1.5 text-white lg:w-md',
        'transition-colors duration-300 has-[input:focus]:bg-white/20',
      )}
    >
      <button
        aria-label={muteLabel}
        className='flex size-9.5 shrink-0 items-center justify-center rounded-full hover:bg-white/15'
        onClick={() => {
          toggleMuted()
          // The slider keeps the focus, so a gamepad or the keyboard carries on from the row
          slider.current?.focus()
        }}
        tabIndex={-1}
        title={muteLabel}
        type='button'
      >
        <span
          className={clsx('size-5', {
            'icon-[mdi--volume-high]': !volume.muted && volume.level > 50,
            'icon-[mdi--volume-low]': !volume.muted && volume.level > 0 && volume.level <= 50,
            'icon-[mdi--volume-off]': volume.muted || volume.level === 0,
          })}
        />
      </button>
      <input
        aria-label={t('emulator.volume')}
        className={clsx(
          'h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none',
          '[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_#000a]',
          '[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white',
          { 'opacity-40': volume.muted },
        )}
        data-sn-adjust
        data-sn-enabled
        data-sn-focus-parent
        data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
        max={100}
        min={0}
        onChange={(event) => update({ level: Number(event.currentTarget.value), muted: false })}
        onClick={handleSliderClick}
        ref={slider}
        step={1}
        style={{ background: `linear-gradient(to right, #fff ${filled}, #ffffff40 ${filled})` }}
        type='range'
        value={volume.level}
      />
      <span className={clsx('w-11 text-right text-[15px] tabular-nums', { 'opacity-40': volume.muted })}>{filled}</span>
    </div>
  )
}
