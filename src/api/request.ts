// A typed client for the server's API, in the shape Hono's client had: `client.roms[':id'].$patch({ form, param })`
// sends PATCH /api/v1/roms/<id> with the form, and the answer's JSON is typed by the route. The routes and their types
// are in ./client.ts

/** An answer whose JSON is a T */
export interface TypedResponse<T> extends Response {
  json: () => Promise<T>
}

/** What a request sends: the address's parameters and query, and a form or JSON body */
export interface RequestInput {
  form?: Record<string, Blob | number | string | undefined | (Blob | number | string)[]>
  json?: unknown
  param?: Record<string, string>
  query?: Record<string, string | undefined | string[]>
}

export interface RequestOptions {
  init?: RequestInit
}

/** What an endpoint that takes nothing takes */
export type NoInput = Record<string, never>

/** An endpoint: called with what it takes, it answers with its JSON's type */
export type Endpoint<Input, Output> = NoInput extends Input
  ? (input?: Input, options?: RequestOptions) => Promise<TypedResponse<Output>>
  : (input: Input, options?: RequestOptions) => Promise<TypedResponse<Output>>

/** The address of an endpoint, with its parameters and query filled in */
export type UrlOf<Input> = (input?: Pick<Input & RequestInput, 'param' | 'query'>) => URL

export type InferRequestType<T> = T extends (input: infer Input, ...rest: any[]) => any ? NonNullable<Input> : never
export type InferResponseType<T> = T extends (...args: any[]) => Promise<infer Answer>
  ? Answer extends { json: () => Promise<infer Output> }
    ? Output
    : never
  : never

/** An answer that wasn't OK, with its status */
export class DetailedError extends Error {
  readonly detail: { data: unknown; statusText: string }
  readonly statusCode: number

  constructor(
    message: string,
    { detail, statusCode }: { detail: { data: unknown; statusText: string }; statusCode: number },
  ) {
    super(message)
    this.name = 'DetailedError'
    this.detail = detail
    this.statusCode = statusCode
  }
}

const nullBodyStatuses = new Set([101, 204, 205, 304])
const jsonType = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json(?:;.+)?$/iu

/** An answer's content, as JSON when it says it's JSON, or text; an answer that isn't OK is thrown as a DetailedError */
export async function parseResponse<R extends Response>(
  response: Promise<R> | R,
): Promise<R extends { json: () => Promise<infer Output> } ? Output : never> {
  const answer = await response
  let content: unknown
  if (answer.body && !nullBodyStatuses.has(answer.status)) {
    const type = answer.headers.get('Content-Type')?.split(';')[0]
    content = type && jsonType.test(type) ? await answer.json() : await answer.text()
  }
  if (!answer.ok) {
    throw new DetailedError(`${answer.status} ${answer.statusText}`, {
      detail: { data: content, statusText: answer.statusText },
      statusCode: answer.status,
    })
  }
  return content as R extends { json: () => Promise<infer Output> } ? Output : never
}

function searchParams(query: NonNullable<RequestInput['query']>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const each of value) {
        params.append(key, each)
      }
    } else if (value !== undefined) {
      params.set(key, value)
    }
  }
  return params
}

// A path's parameters, as ":id", or ":thumbnailId{.+}" for one that may hold slashes
function fillPath(path: string, param: RequestInput['param'] = {}) {
  let filled = path
  for (const [key, value] of Object.entries(param)) {
    filled = filled.replace(new RegExp(`/:${key}(?:\\{[^/]+\\})?\\??(?=/|$)`, 'u'), () => (value ? `/${value}` : ''))
  }
  return filled
}

function addressOf(base: string, segments: string[], input: RequestInput = {}) {
  const query = input.query ? searchParams(input.query).toString() : ''
  const path = fillPath(`${base.replace(/\/+$/u, '')}/${segments.join('/')}`, input.param)
  return query ? `${path}?${query}` : path
}

function formOf(fields: NonNullable<RequestInput['form']>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) {
        form.append(key, each instanceof Blob ? each : String(each))
      }
    }
  }
  return form
}

/**
 * A client whose properties are an address's parts, ending in the method: `$get`, `$post`, `$patch` or `$delete` send
 * a request, `$url` gives the address
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the routes' types are the caller's to give
export function createClient<Routes>(
  base: string,
  send: typeof fetch = async (input, init) => await fetch(input, init),
): Routes {
  function proxy(segments: string[]): unknown {
    return new Proxy(() => {}, {
      apply(_target, _this, args: [RequestInput?, RequestOptions?]) {
        const [input = {}, options = {}] = args
        const method = segments.at(-1)?.slice(1) ?? 'get'
        const address = addressOf(base, segments.slice(0, -1), input)
        if (method === 'url') {
          return new URL(address)
        }
        const headers = new Headers()
        let body: BodyInit | undefined
        if (input.form) {
          body = formOf(input.form)
        }
        if (input.json !== undefined) {
          body = JSON.stringify(input.json)
          headers.set('Content-Type', 'application/json')
        }
        const verb = method.toUpperCase()
        return send(address, {
          body: verb === 'GET' || verb === 'HEAD' ? undefined : body,
          headers,
          method: verb,
          ...options.init,
        })
      },
      get(_target, key) {
        if (typeof key !== 'string' || key === 'then') {
          return
        }
        return proxy([...segments, key])
      },
    })
  }
  return proxy([]) as Routes
}
