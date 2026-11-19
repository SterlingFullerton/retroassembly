import { redirect } from 'react-router'
import { routes } from '../routes.ts'

// The library is the app's front page. The server sends a visit here there too; this is for a link followed in the app
export function clientLoader() {
  throw redirect(routes.libraryHome)
}

export { noop as default } from 'es-toolkit'
