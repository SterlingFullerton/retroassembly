import { getContext } from 'hono/context-storage'
import { countUsers } from '#@/controllers/users/count-users.ts'
import { getAuthMode, getSafeRedirectTo } from '#@/utils/server/auth.ts'

export async function getLoginPageData({ error, redirectTo }: { error?: string; redirectTo?: string }) {
  const { currentUser, t } = getContext().var
  const safeRedirectTo = getSafeRedirectTo(redirectTo)

  if (currentUser) {
    return { redirect: safeRedirectTo }
  }

  if (getAuthMode() === 'oidc') {
    return {
      error: error ? { message: t(`auth.${error}`) } : null,
      formType: 'oidc' as const,
      redirectTo: safeRedirectTo,
      title: t('auth.login'),
    }
  }

  const userCount = await countUsers()
  return {
    error: null,
    formType: userCount ? ('login' as const) : ('register' as const),
    redirectTo: safeRedirectTo,
    title: t('auth.login'),
  }
}
