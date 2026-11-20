import { attemptAsync, isBrowser } from 'es-toolkit'
import { createClient } from './request.ts'
import type { ApiRoutes } from './routes-types.ts'

const baseUrl = isBrowser() ? location.origin : 'http://localhost'

/** The API, whose failures are thrown as what the server answered: its JSON, or the answer itself */
export const client = createClient<ApiRoutes>(`${baseUrl}/api/v1`, async (...args: Parameters<typeof fetch>) => {
  const response = await fetch(...args)
  if (response.ok) {
    return response
  }
  const [, json] = await attemptAsync(() => response.json())
  throw json ?? response
})
export type { InferRequestType, InferResponseType } from './request.ts'
export { parseResponse } from './request.ts'
