import { clsx } from 'clsx'
import { createContext, type ReactNode, useContext } from 'react'
import { resolveConsole } from '#@/consoles/registry.ts'
import { getPadKeys, type PadDirections, type PadKey, type PadKeyGroup, type PadKeys } from '#@/input/pad.ts'
import type { RetroPadInput } from '#@/input/retropad.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'

// The pause menu's picture of the console's controller for a keyboard: each button drawn as the key that plays it, in
// its place on the controller, with the button's own name and colour beside it. Only the buttons the console has, and
// only those with a key. A console's settings draw the same picture with every button, each a key to press to change it

/** For the settings: the button waiting for its new key, and what pressing a key on the picture does */
interface PadEdit {
  listening?: RetroPadInput
  onPick: (input: RetroPadInput, label: string) => void
}
const PadEditContext = createContext<PadEdit | undefined>(undefined)

interface KeycapProps {
  /** On a key of the player's own for this console */
  changed?: boolean
  children: string
  /** A picture in place of the key's name */
  icon?: string
  /** What the emulator reads the button from, and the button's name: with these the key can be pressed to change it */
  input?: RetroPadInput
  label?: string
  wide?: boolean
}

function Keycap({ changed = false, children, icon, input, label = '', wide = false }: Readonly<KeycapProps>) {
  const edit = useContext(PadEditContext)
  const listening = Boolean(edit && input && edit.listening === input)
  const text = listening ? '…' : children
  const shown = icon && !listening ? <span className={clsx('size-7', icon)} /> : text
  const className = clsx(
    'grid h-10 place-items-center rounded-lg px-2 font-semibold shadow-[0_2px_0_#0006]',
    changed ? 'bg-(--accent-9) text-white' : 'bg-white text-neutral-900',
    wide ? 'min-w-16' : 'min-w-10',
    text.length > 2 ? 'text-sm' : 'text-lg',
    { 'outline-3 outline-offset-2 outline-white': listening },
  )
  if (edit && input) {
    return (
      <button
        aria-label={`${label}: ${children || '–'}`}
        aria-pressed={listening}
        className={clsx(className, 'cursor-pointer')}
        data-sn-enabled=''
        onClick={() => edit.onPick(input, label)}
        type='button'
      >
        {shown}
      </button>
    )
  }
  return <span className={className}>{shown}</span>
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
// (React keeps a prop called `key` for itself, so a button is handed over whole)
function FaceKey({ button }: Readonly<{ button: PadKey }>) {
  const { changed, color, icon, input, key: keyName, label } = button
  if (label.length > 2) {
    return (
      <span className='flex flex-col items-center gap-1'>
        <Keycap changed={changed} icon={icon} input={input} label={label}>
          {keyName}
        </Keycap>
        <Caption color={color}>{label}</Caption>
      </span>
    )
  }
  return (
    <span className='relative'>
      <Keycap changed={changed} icon={icon} input={input} label={label}>
        {keyName}
      </Keycap>
      <span
        className='pointer-events-none absolute -top-3.5 -right-3.5 grid size-7 place-items-center rounded-full bg-neutral-800 text-sm font-bold ring-2 ring-black'
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
            {row.map((button) => (
              <FaceKey button={button} key={button.label} />
            ))}
          </div>
        ))}
      </div>
      {label ? <Caption>{label}</Caption> : null}
    </div>
  )
}

const directionPlaces = {
  down: { arrow: '↓', place: 'col-start-2 row-start-3' },
  left: { arrow: '←', place: 'col-start-1 row-start-2' },
  right: { arrow: '→', place: 'col-start-3 row-start-2' },
  up: { arrow: '↑', place: 'col-start-2 row-start-1' },
} as const

// Four directions as a cross of keys, named underneath. A direction has nothing where it has no key, except in the
// settings, where it's an empty key to press. A gamepad's stick is drawn as the stick, which isn't set here
function Directions({ changed, color, inputs, label, stick, ...keys }: Readonly<PadDirections>) {
  return (
    <div className='flex flex-col items-center gap-2'>
      <div className='grid grid-cols-[repeat(3,2.5rem)] grid-rows-[repeat(3,2.5rem)] gap-1'>
        {stick ? (
          <span className='col-span-3 row-span-3 grid place-items-center'>
            <span className='grid size-20 place-items-center rounded-full border-2 border-solid border-white/40 bg-white/10 text-lg font-semibold text-white'>
              {stick}
            </span>
          </span>
        ) : null}
        {(['up', 'left', 'right', 'down'] as const).map((way) =>
          !stick && (keys[way] || inputs) ? (
            <span className={directionPlaces[way].place} key={way}>
              <Keycap
                changed={changed?.includes(way)}
                input={inputs?.[way]}
                label={`${label} ${directionPlaces[way].arrow}`}
              >
                {keys[way]}
              </Keycap>
            </span>
          ) : null,
        )}
      </div>
      <Caption color={color}>{label}</Caption>
    </div>
  )
}

// A shoulder button or one between the hands: a wide key with the button's name beside or under it
function NamedKey({ below = false, button }: Readonly<{ below?: boolean; button: PadKey }>) {
  const { changed, color, icon, input, key: keyName, label } = button
  return (
    <span className={clsx('flex items-center', below ? 'flex-col gap-1' : 'gap-2')}>
      <Keycap changed={changed} icon={icon} input={input} label={label} wide>
        {keyName}
      </Keycap>
      <Caption color={color}>{label}</Caption>
    </span>
  )
}

/**
 * A console's controller with its keys. With `edit`, each key is a button that picks it to be given another key
 */
export function PadView({ edit, pad }: Readonly<{ edit?: PadEdit; pad: PadKeys }>) {
  const { center, face, keypad, leftGroup, moves, rightCluster, rightGroup, shoulders } = pad
  const hasShoulders = shoulders.left.length > 0 || shoulders.right.length > 0

  return (
    <PadEditContext value={edit}>
      <div className='mx-auto flex w-full max-w-3xl flex-col' data-testid='keyboard-pad'>
        {hasShoulders ? (
          <div className='flex justify-between px-14 pb-3'>
            <div className='flex gap-4'>
              {shoulders.left.map((button) => (
                <NamedKey button={button} key={button.label} />
              ))}
            </div>
            <div className='flex gap-4'>
              {shoulders.right.map((button) => (
                <span className='flex flex-row-reverse' key={button.label}>
                  <NamedKey button={button} />
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
            {center.map((button) => (
              <NamedKey below button={button} key={button.label} />
            ))}
            {keypad ? <NamedKey below button={{ key: keypad, label: 'Keypad' }} /> : null}
          </div>

          <div className='flex items-center gap-8'>
            {rightCluster ? <Directions {...rightCluster} /> : null}
            {rightGroup ? <FaceRows {...rightGroup} /> : null}
            <FaceRows rows={face} />
          </div>
        </div>
      </div>
    </PadEditContext>
  )
}

/** The pause menu's controller, on a computer, with the keys the game is played with */
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

  const pad = getPadKeys(resolveConsole(rom.platform, core), keyboard, {
    own: preference.input.consoleKeys?.[rom.platform],
  })
  return (
    <div className='hidden lg:block'>
      <PadView pad={pad} />
    </div>
  )
}
