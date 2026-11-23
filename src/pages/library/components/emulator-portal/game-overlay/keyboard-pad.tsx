import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { resolveConsole } from '#@/consoles/registry.ts'
import { getPadKeys, type PadDirections, type PadKey, type PadKeyGroup } from '#@/input/pad.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'

// The pause menu's picture of the console's controller for a keyboard: each button drawn as the key that plays it, in
// its place on the controller, with the button's own name and colour beside it. Only the buttons the console has, and
// only those with a key

function Keycap({ children, wide = false }: Readonly<{ children: ReactNode; wide?: boolean }>) {
  const text = typeof children === 'string' ? children : ''
  return (
    <span
      className={clsx(
        'grid h-10 place-items-center rounded-lg bg-white px-2 font-semibold text-neutral-900 shadow-[0_2px_0_#0006]',
        wide ? 'min-w-16' : 'min-w-10',
        text.length > 2 ? 'text-sm' : 'text-lg',
      )}
    >
      {children}
    </span>
  )
}

function Caption({ children, color }: Readonly<{ children: ReactNode; color?: string }>) {
  return (
    <span className='text-sm font-semibold whitespace-nowrap text-white/85' style={color ? { color } : undefined}>
      {children}
    </span>
  )
}

// A button under a thumb: its key, with a short name pinned to the key's corner like the mark on the button, or a
// longer one written under it
function FaceKey({ color, keyName, label }: Readonly<{ color?: string; keyName: string; label: string }>) {
  if (label.length > 2) {
    return (
      <span className='flex flex-col items-center gap-1'>
        <Keycap>{keyName}</Keycap>
        <Caption color={color}>{label}</Caption>
      </span>
    )
  }
  return (
    <span className='relative'>
      <Keycap>{keyName}</Keycap>
      <span
        className='absolute -top-3.5 -right-3.5 grid size-7 place-items-center rounded-full bg-neutral-800 text-sm font-bold ring-2 ring-black'
        style={color ? { color } : undefined}
      >
        {label}
      </span>
    </span>
  )
}

// Rows of buttons from the top. A diamond is one, two and one: its middle row is spread to leave the centre open
function FaceRows({ label, rows }: Readonly<PadKeyGroup>) {
  const diamond = rows.length === 3 && rows[1].length === 2
  return (
    <div className='flex flex-col items-center gap-2'>
      <div className={clsx('flex flex-col items-center', diamond ? 'gap-1' : 'gap-5')}>
        {rows.map((row, index) => (
          <div
            className={clsx('flex items-start', diamond && index === 1 ? 'gap-12' : 'gap-5')}
            key={row.map(({ label }) => label).join(' ')}
          >
            {row.map(({ color, key, label }) => (
              <FaceKey color={color} key={label} keyName={key} label={label} />
            ))}
          </div>
        ))}
      </div>
      {label ? <Caption>{label}</Caption> : null}
    </div>
  )
}

// One direction's key in its place in the cross; nothing where it has no key
function directionKey(name: string, place: string) {
  return name ? (
    <span className={place}>
      <Keycap>{name}</Keycap>
    </span>
  ) : null
}

// Four directions as a cross of keys, named underneath
function Directions({ color, down, label, left, right, up }: Readonly<PadDirections>) {
  return (
    <div className='flex flex-col items-center gap-2'>
      <div className='grid grid-cols-[repeat(3,2.5rem)] grid-rows-[repeat(3,2.5rem)] gap-1'>
        {directionKey(up, 'col-start-2 row-start-1')}
        {directionKey(left, 'col-start-1 row-start-2')}
        {directionKey(right, 'col-start-3 row-start-2')}
        {directionKey(down, 'col-start-2 row-start-3')}
      </div>
      <Caption color={color}>{label}</Caption>
    </div>
  )
}

// A shoulder button or one between the hands: a wide key with the button's name beside or under it
function NamedKey({
  below = false,
  color,
  keyName,
  label,
}: Readonly<{ below?: boolean } & Omit<PadKey, 'key'> & { keyName: string }>) {
  return (
    <span className={clsx('flex items-center', below ? 'flex-col gap-1' : 'gap-2')}>
      <Keycap wide>{keyName}</Keycap>
      <Caption color={color}>{label}</Caption>
    </span>
  )
}

export function KeyboardPad() {
  const { connected } = useGamepads()
  const { keyboard } = useInputMapping()
  const { preference } = usePreference()
  const rom = useRom()
  const core = rom ? preference.emulator.platform[rom.platform]?.core : undefined
  // With a gamepad the keys aren't what's played with
  if (!rom || !core || connected) {
    return null
  }

  const { center, face, keypad, leftGroup, moves, rightCluster, rightGroup, shoulders } = getPadKeys(
    resolveConsole(rom.platform, core),
    keyboard,
  )
  const hasShoulders = shoulders.left.length > 0 || shoulders.right.length > 0

  return (
    <div className='mx-auto hidden w-full max-w-3xl flex-col lg:flex' data-testid='keyboard-pad'>
      {hasShoulders ? (
        <div className='flex justify-between px-14 pb-3'>
          <div className='flex gap-4'>
            {shoulders.left.map(({ color, key, label }) => (
              <NamedKey color={color} key={label} keyName={key} label={label} />
            ))}
          </div>
          <div className='flex gap-4'>
            {shoulders.right.map(({ color, key, label }) => (
              <span className='flex flex-row-reverse' key={label}>
                <NamedKey color={color} keyName={key} label={label} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className='flex items-center justify-between gap-6 rounded-[4rem] border border-solid border-white/25 bg-black/60 px-10 py-6'>
        <div className='flex items-center gap-8'>
          {moves.map((cluster) => (
            <Directions key={cluster.label} {...cluster} />
          ))}
          {leftGroup ? <FaceRows {...leftGroup} /> : null}
        </div>

        <div className='flex flex-wrap items-end justify-center gap-4 self-end'>
          {center.map(({ color, key, label }) => (
            <NamedKey below color={color} key={label} keyName={key} label={label} />
          ))}
          {keypad ? <NamedKey below keyName={keypad} label='Keypad' /> : null}
        </div>

        <div className='flex items-center gap-8'>
          {rightCluster ? <Directions {...rightCluster} /> : null}
          {rightGroup ? <FaceRows {...rightGroup} /> : null}
          <FaceRows rows={face} />
        </div>
      </div>
    </div>
  )
}
