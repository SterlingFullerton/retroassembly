import { Button } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import type { clientLoader as loader } from '../routes/login.tsx'
import { LoginForm } from './components/log-in-form.tsx'
import { LogInWithOidcButton } from './components/log-in-with-oidc-button.tsx'
import { PageContainer } from './components/page-container.tsx'
import { RegisterForm } from './components/register-form.tsx'

export function LoginPage() {
  const { t } = useTranslation()
  const data = useLoaderData<typeof loader>()
  const { error, redirectTo } = data
  // With OPEN_SIGNUP, a visitor switches between logging in and making an account
  const [signingUp, setSigningUp] = useState(false)
  const signupOpen = 'signupOpen' in data && data.signupOpen
  const formType = data.formType === 'login' && signupOpen && signingUp ? 'register' : data.formType

  if (error) {
    return <PageContainer title={t('auth.login')}>{error.message}</PageContainer>
  }

  const title = formType === 'register' ? metadata.title : t('auth.loginToTitle', { title: metadata.title })
  const description = {
    oidc: t('auth.loginToBuildCollection'),
    register: t('auth.createAccountToGetStarted'),
  }[formType]
  return (
    <PageContainer description={description} title={title}>
      {formType === 'register' ? <RegisterForm redirectTo={redirectTo} /> : null}
      {formType === 'login' ? <LoginForm redirectTo={redirectTo} /> : null}
      {formType === 'oidc' ? <LogInWithOidcButton redirectTo={redirectTo} /> : null}
      {signupOpen && data.formType === 'login' ? (
        <div className='mt-4 flex justify-center'>
          <Button onClick={() => setSigningUp(!signingUp)} type='button' variant='ghost'>
            {signingUp ? t('auth.login') : t('auth.createYourAccount')}
          </Button>
        </div>
      ) : null}
    </PageContainer>
  )
}
