import { useSetAtom } from 'jotai'
import { noticeAtom } from '#@/pages/atoms.ts'

let lastId = 0

/** Says, over the page for a few seconds, that something the user just did failed */
export function useNotice() {
  const setNotice = useSetAtom(noticeAtom)

  return function notify(message: string) {
    lastId += 1
    setNotice({ id: lastId, message })
  }
}
