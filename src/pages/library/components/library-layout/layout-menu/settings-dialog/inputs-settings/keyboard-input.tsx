import { Button, TextField } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'

function handleChange(event: ChangeEvent<HTMLInputElement>) {
  event.preventDefault()
}

interface KeyboardInputProps {
  button: {
    iconClass?: string
    iconNode?: ReactNode
    name: string
    text?: string
  }
}

export function KeyboardInput({ button }: Readonly<KeyboardInputProps>) {
  const { isLoading, update } = usePreference()
  const keyboardMapping = useKeyboardMapping()

  const value = keyboardMapping[button.name]
  const clearable = Boolean(value)

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const keyName = getKeyNameFromCode(event.code)
    if (keyName) {
      const newMapping = { ...keyboardMapping, [button.name]: keyName }
      const conflicts = Object.entries(keyboardMapping).filter(
        ([key, value]) => value === keyName && key !== button.name,
      )
      for (const [conflict] of conflicts) {
        newMapping[conflict] = null
      }
      await update({ input: { keyboardMapping: newMapping } })
    }
  }

  async function handleClickClear() {
    await update({ input: { keyboardMapping: { ...keyboardMapping, [button.name]: null } } })
  }

  // A row: the control's icon and name on the left, its key on the right
  return (
    <label className='flex items-center justify-between gap-3 border-b border-(--gray-4) py-1.5'>
      <span className='flex min-w-0 items-center gap-2 text-sm'>
        <span className='flex w-12 shrink-0 justify-center text-xs font-semibold text-(--color-text)/70'>
          {button.iconClass ? <span className={clsx('size-6', button.iconClass)} /> : button.iconNode}
        </span>
        {button.text ? <span className='truncate'>{button.text}</span> : null}
      </span>
      <TextField.Root
        className='w-28 shrink-0'
        onChange={handleChange}
        onFocus={(event) => event.target.select()}
        onKeyDown={handleKeyDown}
        readOnly={isLoading}
        size='2'
        value={value ?? ''}
      >
        <TextField.Slot />
        <TextField.Slot>
          {clearable ? (
            <Button className='-translate-x-1!' onClick={handleClickClear} size='1' title='Clear' variant='ghost'>
              <span className='icon-[mdi--close]' />
            </Button>
          ) : null}
        </TextField.Slot>
      </TextField.Root>
    </label>
  )
}
