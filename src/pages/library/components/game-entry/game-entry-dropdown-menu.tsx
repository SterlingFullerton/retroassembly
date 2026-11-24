import { Checkbox, DropdownMenu, IconButton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { client, parseResponse } from '#@/api/client.ts'
import { routes } from '#@/pages/routes.ts'
import { useGameSelection } from '../../atoms.ts'
import { useGameActions } from '../../hooks/use-game-actions.ts'
import { DeleteDialog } from '../delete-dialog.tsx'

export function GameEntryDropdownMenu({ rom }) {
  const { pathname } = useLocation()
  const { actions } = useGameActions()
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const { selected, selecting, setSelected } = useGameSelection(rom.id)
  // Deleting the game, or on the history page removing it from the history
  const deleteAction = actions.find(({ name }) => name === 'delete')

  async function deleteGame() {
    const param = { id: rom.id }
    const romEndpoint = client.roms[':id']
    await (deleteAction?.type === 'launch_records'
      ? parseResponse(romEndpoint.launch_records.$delete({ param }))
      : parseResponse(romEndpoint.$delete({ param })))
  }

  function handleCheckedChange(checked: boolean) {
    setSelected(checked)
  }

  function handleClickSelect() {
    setSelected(true)
  }

  function handleClickDelete() {
    setDeleteDialogOpen(true)
  }

  function handleClick(name: string) {
    const handlers = { delete: handleClickDelete, select: handleClickSelect }
    const handler = handlers[name]
    handler?.()
  }

  // Nothing to offer: a game in the library, to someone who can't delete games
  if (actions.length === 0) {
    return
  }

  if (pathname === routes.libraryHome) {
    return
  }

  if (selecting) {
    return (
      <div className='absolute top-1 right-1 z-1'>
        <Checkbox checked={selected} onCheckedChange={handleCheckedChange} value={rom.id} />
      </div>
    )
  }

  return (
    <>
      <DropdownMenu.Root onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenu.Trigger>
          <div
            // Above the game's cover, but below the red bars at the top and bottom of a phone's screen, so a tap on a bar
            // never lands on it. With a mouse it shows while the pointer is over the game; on a touch screen, always
            className={clsx('absolute top-1 right-1 z-1 transition-opacity group-hover:opacity-100', {
              '[@media(hover:hover)]:opacity-0': !menuOpen,
            })}
          >
            <IconButton
              aria-label='Menu'
              className='bg-(--gray-1)!'
              data-sn-skip=''
              size='1'
              title='Menu'
              variant='ghost'
            >
              <span className='icon-[mdi--more-vert] font-bold text-(--accent-9)' />
            </IconButton>
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {actions.map((action) => (
            <DropdownMenu.Item color={action.color} key={action.name} onClick={() => handleClick(action.name)}>
              <span className={action.icon} />
              {action.text}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {deleteAction ? (
        <DeleteDialog
          description={deleteAction.confirmDescription}
          onConfirm={deleteGame}
          onOpenChange={setDeleteDialogOpen}
          open={deleteDialogOpen}
          title={deleteAction.text}
        />
      ) : null}
    </>
  )
}
