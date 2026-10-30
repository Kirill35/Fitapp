/** Tiny key-value store. The browser one survives blocked or full localStorage by falling back to memory. */
export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export function browserKV(): KV {
  const mem = new Map<string, string>() // only holds values localStorage refused to take
  return {
    get(k) {
      if (mem.has(k)) return mem.get(k)!
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v)
        mem.delete(k)
      } catch {
        mem.set(k, v)
      }
    },
    remove(k) {
      mem.delete(k)
      try {
        localStorage.removeItem(k)
      } catch {
        /* nothing to remove */
      }
    },
  }
}

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }
}
