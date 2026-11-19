import { clsx } from 'clsx'

/** Short names for the consoles whose full name doesn't fit the red bar on a small phone */
const shortNames: Record<string, string> = {
  fds: 'FDS',
  gba: 'GBA',
  gbc: 'GBC',
  ngpc: 'NGPC',
  odyssey2: 'Odyssey 2',
  psp: 'PSP',
  videopac: 'Videopac+',
  wonderswancolor: 'WSC',
}

interface HeaderLinkItemProps {
  /** In the red bar itself: a short name on a small phone, where there is one */
  inBar?: boolean
  link?: {
    name?: string
    iconClass?: string
    iconUrl?: string
    text: string
  }
}

export function HeaderLinkItem({ inBar = false, link }: Readonly<HeaderLinkItemProps>) {
  if (link) {
    return (
      <div className='flex min-w-0 items-center gap-1'>
        {link.iconClass ? <span className={clsx('size-5 shrink-0', link.iconClass)} /> : null}
        {link.iconUrl ? <img alt={link.text} className='size-5 shrink-0' src={link.iconUrl} /> : null}
        {inBar && link.name && shortNames[link.name] ? (
          <>
            <span className='truncate max-[374px]:hidden'>{link.text}</span>
            <span className='hidden truncate max-[374px]:inline'>{shortNames[link.name]}</span>
          </>
        ) : (
          <span className='truncate'>{link.text}</span>
        )}
      </div>
    )
  }
}
