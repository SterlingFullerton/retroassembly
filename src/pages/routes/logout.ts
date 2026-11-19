import { getContext } from 'hono/context-storage'
import { deleteCookie } from 'hono/cookie'
import { invalidateSession } from '#@/controllers/sessions/invalidate-session.ts'

export async function loader() {
  const c = getContext()

  const { token } = c.var
  // The session cookie is sent on links from other sites too (SameSite=Lax), so only the app itself may log out: a link
  // to /logout elsewhere would otherwise sign the player out
  const site = c.req.header('Sec-Fetch-Site')
  const fromElsewhere = site === 'cross-site' || site === 'same-site'

  if (token && !fromElsewhere) {
    await invalidateSession()
    deleteCookie(c, 'token')
  }

  return c.redirect('/')
}

export { noop as default } from 'es-toolkit'
