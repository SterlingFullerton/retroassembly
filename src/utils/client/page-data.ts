import { attemptAsync, isBrowser } from 'es-toolkit'
import { type ClientResponse, DetailedError, hc, parseResponse } from 'hono/client'
import { data, redirect } from 'react-router'
import type { AppType } from '#@/api/app.ts'
import { defaultRedirectTo } from '#@/constants/auth.ts'
import { routes } from '#@/pages/routes.ts'

/** The pages' data, from /api/v1/pages */
export const pagesClient = hc<AppType>(isBrowser() ? location.origin : 'http://localhost').api.v1.pages

/** Where to log in, and come back to the page asked for after */
export function getLoginUrl(request: Request) {
  const { pathname, search } = new URL(request.url)
  const redirectTo = `${pathname}${search}`
  const loginUrl = new URL(routes.login, 'http://localhost')
  if (redirectTo !== defaultRedirectTo) {
    loginUrl.searchParams.set('redirect_to', redirectTo)
  }
  return `${loginUrl.pathname}${loginUrl.search}`
}

/** The query of the page's own address, passed on for lists' sort, order, page and search */
export function getPageQuery(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams)
}

/** The options for a request made for this page, which is cancelled when the page is left before it loads */
export function getPageRequestOptions(request: Request) {
  return { init: { signal: request.signal } }
}

/**
 * A page's data, or what the page shows instead: someone not signed in is sent to log in, and anything else that went
 * wrong (a game that isn't there) is shown on the error page
 */
export async function readPageData<T extends ClientResponse<unknown>>(request: Request, response: Promise<T>) {
  const parsed = parseResponse(response)
  const [error] = await attemptAsync(() => parsed)
  if (error instanceof DetailedError) {
    if (error.statusCode === 401) {
      throw redirect(getLoginUrl(request))
    }
    throw data(error.message, { status: error.statusCode })
  }
  if (error) {
    throw error
  }
  return parsed
}
