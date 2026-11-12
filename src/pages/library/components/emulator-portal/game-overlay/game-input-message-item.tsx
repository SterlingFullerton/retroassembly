import { Kbd } from '@radix-ui/themes'
import { upperFirst } from 'es-toolkit'
import { Fragment, type PropsWithChildren } from 'react'

interface GameInputMessageItemProps extends PropsWithChildren {
  keyNames?: string[]
}

export function GameInputMessageItem({ children, keyNames }: Readonly<GameInputMessageItemProps>) {
  return (
    <div className='flex items-center gap-2'>
      {keyNames?.map((keyName, i) => (
        <Fragment key={keyName}>
          <Kbd className='!text-(--accent-9)' size='1'>
            {/* Only the first letter, so keys shown together ("I J K L") keep their capitals */}
            {upperFirst(keyName)}
          </Kbd>
          {i < keyNames.length - 1 ? <>+</> : null}
        </Fragment>
      ))}

      {children}
    </div>
  )
}
