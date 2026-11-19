import { attemptAsync } from 'es-toolkit'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { DateTime } from 'luxon'
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client'
import { createSessionForUser } from '#@/controllers/sessions/create-session.ts'
import { invalidateSession } from '#@/controllers/sessions/invalidate-session.ts'
import { getOrCreateOidcUser } from '#@/controllers/users/get-or-create-oidc-user.ts'
import { authenticationMethodEnum } from '#@/databases/schema.ts'
import { routes } from '#@/pages/routes.ts'
import { getAuthMode, getSafeRedirectTo } from '#@/utils/server/auth.ts'
import {
  getOidcCallbackUrl,
  getOidcConfiguration,
  getOidcSettings,
  getOidcUsernameAndRoles,
} from '#@/utils/server/oidc.ts'
import { isSecureRequest, setSessionCookie } from '#@/utils/server/session.ts'

// The addresses that only lead somewhere else, answered by the server since they set or clear cookies

const flowCookiePath = routes.loginOidcCallback
const flowCookieNames = ['oidc-code-verifier', 'oidc-nonce', 'oidc-redirect-to', 'oidc-state']

function clearFlowCookies(c: Context) {
  for (const name of flowCookieNames) {
    deleteCookie(c, name, { path: flowCookiePath })
  }
}

function isOidcCallbackSecure() {
  return isSecureRequest() || new URL(getOidcCallbackUrl()).protocol === 'https:'
}

async function finishOidcLogin(c: Context) {
  const codeVerifier = getCookie(c, 'oidc-code-verifier')
  const nonce = getCookie(c, 'oidc-nonce')
  const state = getCookie(c, 'oidc-state')
  if (!codeVerifier || !nonce || !state) {
    return '/login?error=oidc_invalid_state'
  }

  const callbackUrl = new URL(getOidcCallbackUrl())
  callbackUrl.search = new URL(c.req.url).search
  const tokenSet = await authorizationCodeGrant(await getOidcConfiguration(), callbackUrl, {
    expectedNonce: nonce,
    expectedState: state,
    pkceCodeVerifier: codeVerifier,
  })
  const claims = tokenSet.claims()
  if (!claims) {
    throw new Error('The OIDC response does not contain an ID token')
  }

  const settings = getOidcSettings()
  const { roles, username } = getOidcUsernameAndRoles(claims, Boolean(settings.requiredRole))
  if (settings.requiredRole && !roles.includes(settings.requiredRole)) {
    throw new HTTPException(403, { message: 'The OIDC identity does not have the required role' })
  }

  const user = getOrCreateOidcUser({ issuer: claims.iss, subject: claims.sub, username })
  const expiresAt = DateTime.now().plus({ milliseconds: settings.sessionMaxAge }).toJSDate()
  const session = await createSessionForUser({
    authenticationMethod: authenticationMethodEnum.oidc,
    expiresAt,
    userId: user.id,
  })
  setSessionCookie(session.token, session.expiresAt, isOidcCallbackSecure())
  return getSafeRedirectTo(getCookie(c, 'oidc-redirect-to'))
}

// The library is the app's front page. Answered before the build's files, which would otherwise send index.html for it
export const homeRoute = new Hono().get(routes.home, (c) => c.redirect(routes.libraryHome))

export const redirectRoutes = new Hono()
  .get(routes.logout, async (c) => {
    // The session cookie is sent on links from other sites too (SameSite=Lax), so only the app itself may log out: a
    // link to /logout elsewhere would otherwise sign the player out
    const site = c.req.header('Sec-Fetch-Site')
    const fromElsewhere = site === 'cross-site' || site === 'same-site'
    if (c.var.token && !fromElsewhere) {
      await invalidateSession()
      deleteCookie(c, 'token')
    }
    return c.redirect(routes.home)
  })

  .get(routes.loginOidc, async (c) => {
    if (getAuthMode() !== 'oidc') {
      return c.redirect(routes.login)
    }
    const redirectTo = getSafeRedirectTo(c.req.query('redirect_to'))
    if (c.var.currentUser) {
      return c.redirect(redirectTo)
    }

    const configuration = await getOidcConfiguration()
    const codeVerifier = randomPKCECodeVerifier()
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier)
    const nonce = randomNonce()
    const state = randomState()
    const options = {
      httpOnly: true,
      maxAge: 10 * 60,
      path: flowCookiePath,
      sameSite: 'Lax',
      secure: isOidcCallbackSecure(),
    } as const
    setCookie(c, 'oidc-code-verifier', codeVerifier, options)
    setCookie(c, 'oidc-nonce', nonce, options)
    setCookie(c, 'oidc-redirect-to', redirectTo, options)
    setCookie(c, 'oidc-state', state, options)

    const authorizationUrl = buildAuthorizationUrl(configuration, {
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      redirect_uri: getOidcCallbackUrl(),
      scope: getOidcSettings().scopes,
      state,
    })
    return c.redirect(authorizationUrl.href)
  })

  .get(routes.loginOidcCallback, async (c) => {
    if (getAuthMode() !== 'oidc') {
      return c.redirect(routes.login)
    }
    const [error, redirectTo] = await attemptAsync(() => finishOidcLogin(c))
    if (error) {
      console.error('OIDC callback failed:', error instanceof Error ? error.message : 'Unknown error')
    }
    clearFlowCookies(c)
    return c.redirect(redirectTo ?? '/login?error=oidc_callback_failed')
  })
