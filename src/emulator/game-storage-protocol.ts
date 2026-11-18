// What the page and its game storage workers say to each other

export interface StoreMessage { name: string; type: 'store'; url: string }
export interface ReadMessage { buffer: SharedArrayBuffer; name: string; type: 'read' }
export type WorkerReply =
  | { error: string; type: 'error' }
  | { loaded: number; total?: number; type: 'progress' }
  | { size: number; type: 'ready' }
  | { etag?: string; size: number; type: 'stored' }

// The shared memory's layout, used by the page too: four numbers, the position to read from, then the bytes read
export const readState = { done: 2, idle: 0, request: 1 } as const
export const dataOffset = 32
