import { Button } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse, Link } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import { routes } from '#@/pages/routes.ts'
import type { Route } from '../+types/root.ts'

/** Whether an error is a request that never reached the server: what a browser throws when the network fails */
function isUnreachable(error: unknown) {
  return (
    error instanceof TypeError &&
    /failed to fetch|load failed|networkerror|network request failed/iu.test(error.message)
  )
}

// The same page again, with its sort, search and page, which are in its address
function handleClickRetry() {
  globalThis.location.reload()
}

export function ErrorPage({ error }: Readonly<Route.ErrorBoundaryProps>) {
  const { t } = useTranslation()

  let message = t('common.oops')
  let details = t('error.unexpected')
  let stack = ''
  let status = t('error.unexpectedTitle')

  if (isRouteErrorResponse(error)) {
    status = `${error.status}`
    message = error.status === 404 ? t('error.notFoundCode') : t('common.error')
    details = error.status === 404 ? t('error.pageNotFoundDescription') : error.statusText || details
  } else if (isUnreachable(error)) {
    // A request that never got an answer, as on a connection that dropped for a moment: said plainly
    details = t('error.cannotReachServer')
  } else if (error instanceof Error) {
    details = error.message
    // Where it happened is for whoever is working on the app, not for someone using it
    if (import.meta.env.DEV && error.stack) {
      stack = error.stack
    }
  }

  return (
    <>
      <title>{`${status} - ${metadata.title}`}</title>
      <div className='min-h-dvh bg-(--accent-9) py-20'>
        <main className='mx-8 flex max-w-full flex-col rounded-xl bg-(--color-background) p-10 md:mx-auto md:w-3xl'>
          <h1 className='mt-4 flex items-center gap-2 text-4xl font-semibold'>
            <span className='icon-[mdi--robot-confused]' /> {message}
          </h1>
          <p className='py-4 text-lg'>{details}</p>
          {stack && (
            <pre className='mb-4 w-full overflow-x-auto rounded-lg bg-neutral-900 p-4 text-xs text-neutral-100'>
              <code>{stack}</code>
            </pre>
          )}
          <div className='flex flex-wrap justify-center gap-4'>
            <Button onClick={handleClickRetry} radius='small' size='2' type='button'>
              <span className='icon-[mdi--reload]' />
              {t('common.retry')}
            </Button>

            <Button asChild radius='small' size='2' type='button' variant='outline'>
              <Link
                className='border-2! bg-(--color-background)! shadow-none! in-[.dark]:border-(--gray-4)!'
                reloadDocument
                to='/'
              >
                <span className='icon-[mdi--home]' />
                {t('nav.home')}
              </Link>
            </Button>

            <Button asChild radius='small' size='2' type='button' variant='outline'>
              <Link
                className='border-2! bg-(--color-background)! shadow-none! in-[.dark]:border-(--gray-4)!'
                reloadDocument
                to={routes.libraryHome}
              >
                <span className='icon-[mdi--bookshelf]' />
                {t('nav.library')}
              </Link>
            </Button>
          </div>
        </main>
      </div>
    </>
  )
}
