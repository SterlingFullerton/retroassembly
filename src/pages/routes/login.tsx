import { redirect } from 'react-router'
import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import { LoginPage } from '../login/page.tsx'
import type { Route } from './+types/login.ts'

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { searchParams } = new URL(request.url)
  const query = {
    error: searchParams.get('error') ?? undefined,
    redirect_to: searchParams.get('redirect_to') ?? undefined,
  }
  const data = await readPageData(request, pagesClient.login.$get({ query }, getPageRequestOptions(request)))
  if ('redirect' in data) {
    throw redirect(data.redirect)
  }
  return data
}

export default function LoginRoute() {
  return <LoginPage />
}
