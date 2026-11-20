import { setTimeout } from 'node:timers/promises'
import { test as base } from '@playwright/test'
import { customAlphabet } from 'nanoid'
import { nolookalikes } from 'nanoid-dictionary'

const nanoid = customAlphabet(nolookalikes, 10)

interface User {
  password: string
  username: string
}

// Only the first account can sign up, so it's this one, on the throwaway server the tests start, and it adds each
// test's own account
const admin = { password: 'e2e-admin-password', username: 'e2e-admin' }

function form(values: Record<string, string>) {
  const formData = new FormData()
  for (const [name, value] of Object.entries(values)) {
    formData.append(name, value)
  }
  return formData
}

async function signUpOrSignIn(baseURL: string | undefined) {
  const registered = await fetch(new URL('api/v1/auth/register', baseURL), { body: form(admin), method: 'POST' })
  if (registered.ok) {
    const { session } = (await registered.json()) as { session: { token: string } }
    return session.token
  }
  // Another worker is signing the admin up. Waited for on the login page's data, which checks no password, so the
  // wait doesn't count as failed sign-ins
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const page = await fetch(new URL('api/v1/pages/login', baseURL))
    const { formType } = (await page.json()) as { formType: string }
    if (formType === 'login') {
      break
    }
    await setTimeout(250)
  }
  const response = await fetch(new URL('api/v1/auth/login', baseURL), { body: form(admin), method: 'POST' })
  if (!response.ok) {
    throw new Error(`The test admin could not sign in: ${response.status} ${await response.text()}`)
  }
  const { session } = (await response.json()) as { session: { token: string } }
  return session.token
}

let adminToken: Promise<string> | undefined

/** The admin's session token, signed up by the first worker and signed in to once by each of the others */
function getAdminToken(baseURL: string | undefined) {
  adminToken ??= signUpOrSignIn(baseURL)
  return adminToken
}

export const test = base.extend<{ user: User }>({
  user: [
    async ({ baseURL }, use) => {
      const user = {
        password: nanoid(),
        username: nanoid(),
      }

      const token = await getAdminToken(baseURL)
      const response = await fetch(new URL('api/v1/users', baseURL), {
        body: form({ ...user, libraryMode: '0' }),
        headers: { Cookie: `token=${token}` },
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(`The test account could not be added: ${response.status} ${await response.text()}`)
      }

      await use(user)
    },
    { scope: 'test' },
  ],
})
