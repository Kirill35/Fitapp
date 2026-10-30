import type { Session } from '../domain/types'
import { ApiClient, ApiError, type ApiOptions } from './ApiClient'
import type { KV } from './kv'
import { LocalStorageRepository, parseBackup } from './LocalStorageRepository'
import type { ProgramInfo, SyncControl, SyncInfo, SyncState, WorkoutRepository } from './WorkoutRepository'
import { checkProgram } from '../../shared/schema'

const TOKEN = 'liftlog.token.v1'
const OUTBOX = 'liftlog.outbox.v1'
const CURSOR = 'liftlog.cursor.v1'
const PROGRAM = 'liftlog.program.v1'

export interface SyncedOptions extends ApiOptions {
  /** Wait after a save before uploading, so a burst of taps is one request. */
  debounceMs?: number
}

/**
 * Local first: every read and write goes to the on-device store. Changes are queued
 * (the outbox) and uploaded in the background; new data from other devices is pulled
 * with a server cursor. Conflicts: last write wins per session, decided by the server.
 */
export class SyncedRepository implements WorkoutRepository, SyncControl {
  sync = this
  private listeners = new Set<() => void>()
  private revision = 0
  private state: SyncState
  private lastSync?: string
  private error?: string
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private local: LocalStorageRepository,
    private kv: KV,
    private opts: SyncedOptions = {},
  ) {
    this.state = this.hasToken() ? 'pending' : 'local'
  }

  // ---- WorkoutRepository (always local) ----

  async getProgram(): Promise<ProgramInfo> {
    try {
      const raw = this.kv.get(PROGRAM)
      if (raw) {
        const c = JSON.parse(raw) as { version: number; program: unknown }
        const check = checkProgram(c.program)
        if (check.ok) return { version: c.version, program: check.program }
      }
    } catch {
      /* fall back to the bundled program */
    }
    return this.local.getProgram()
  }

  listSessions() {
    return this.local.listSessions()
  }

  async saveSession(session: Session): Promise<void> {
    await this.local.saveSession(session)
    this.enqueue([session.id])
    this.schedule()
  }

  exportData() {
    return this.local.exportData()
  }

  async importData(json: string): Promise<void> {
    const sessions = parseBackup(json) // validates before anything changes
    await this.local.importData(json)
    this.enqueue(sessions.map((s) => s.id)) // the server decides, by timestamp, what is actually newer
    this.schedule()
  }

  async clearSessions(): Promise<void> {
    await this.local.clearSessions()
    this.kv.set(OUTBOX, '[]')
    this.kv.remove(CURSOR)
    this.emit()
  }

  // ---- SyncControl ----

  info(): SyncInfo {
    return { state: this.hasToken() ? this.state : 'local', pending: this.outbox().length, lastSync: this.lastSync, error: this.error, revision: this.revision }
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  hasToken() {
    return !!this.kv.get(TOKEN)
  }

  setToken(token: string | null) {
    const t = token?.trim()
    if (t) {
      this.kv.set(TOKEN, t)
      this.state = 'pending'
      this.error = undefined
      this.emit()
      void this.syncNow()
    } else {
      this.kv.remove(TOKEN)
      this.state = 'local'
      this.emit()
    }
  }

  /** Call once at startup: sync now, and again whenever the app comes back or the network returns. */
  start() {
    void this.syncNow()
    if (typeof window === 'undefined') return
    window.addEventListener('online', () => void this.syncNow())
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void this.syncNow())
    setInterval(() => document.visibilityState === 'visible' && void this.syncNow(), 5 * 60_000)
  }

  syncNow(): Promise<void> {
    if (!this.kv.get(TOKEN)) return Promise.resolve()
    if (this.running) {
      this.again = true // something changed mid-sync: the running loop goes round once more
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          const token = this.kv.get(TOKEN)
          if (!token) break
          await this.run(new ApiClient(token, this.opts))
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  // ---- internals ----

  private outbox(): string[] {
    try {
      const v = JSON.parse(this.kv.get(OUTBOX) ?? '[]')
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }

  private setOutbox(ids: string[]) {
    this.kv.set(OUTBOX, JSON.stringify([...new Set(ids)]))
  }

  private enqueue(ids: string[]) {
    this.setOutbox([...this.outbox(), ...ids])
    if (this.hasToken() && this.state === 'synced') this.state = 'pending'
    this.emit()
  }

  private schedule() {
    if (!this.hasToken()) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.syncNow(), this.opts.debounceMs ?? 1000)
  }

  private emit() {
    for (const l of [...this.listeners]) l()
  }

  private async run(api: ApiClient) {
    this.state = 'syncing'
    this.emit()
    try {
      const rejected = await this.push(api)
      await this.pull(api)
      await this.pullProgram(api)
      this.lastSync = new Date().toISOString()
      this.error = rejected.length ? `The server refused ${rejected.length} session(s): ${rejected[0]}` : undefined
      this.state = this.error ? 'error' : this.outbox().length ? 'pending' : 'synced'
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('http', e instanceof Error ? e.message : 'Sync failed')
      if (err.kind === 'auth') {
        this.state = 'unauthorized'
        this.error = undefined
      } else if (err.transient) {
        this.state = 'offline'
        this.error = undefined
      } else {
        this.state = 'error'
        this.error = err.message
      }
    }
    this.emit()
  }

  /** Upload queued sessions. Returns messages for sessions the server will never accept. */
  private async push(api: ApiClient): Promise<string[]> {
    const rejected: string[] = []
    for (const id of this.outbox()) {
      const s = this.local.get(id)
      if (!s) {
        this.setOutbox(this.outbox().filter((x) => x !== id))
        continue
      }
      try {
        const r = await api.putSession(s)
        if (!r.applied && r.session && r.session.updatedAt > (this.local.get(id)?.updatedAt ?? '')) {
          // The server holds a newer version (edited elsewhere): adopt it.
          this.local.applyRemote([r.session])
          this.revision++
          this.setOutbox(this.outbox().filter((x) => x !== id))
          continue
        }
        // Keep it queued if it was edited again while this upload was in flight.
        if (this.local.get(id)?.updatedAt === s.updatedAt) this.setOutbox(this.outbox().filter((x) => x !== id))
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'http' && !e.transient) {
          // A permanent refusal would block the queue forever; drop it and report.
          rejected.push(`${id}: ${e.message}`)
          this.setOutbox(this.outbox().filter((x) => x !== id))
        } else throw e
      }
      this.emit()
    }
    return rejected
  }

  private async pull(api: ApiClient) {
    let cursor = Number(this.kv.get(CURSOR) ?? 0) || 0
    for (;;) {
      const page = await api.sessionsSince(cursor)
      if (this.local.applyRemote(page.sessions)) this.revision++
      cursor = page.cursor
      this.kv.set(CURSOR, String(cursor))
      if (!page.more) break
    }
  }

  private async pullProgram(api: ApiClient) {
    const p = await api.getProgram()
    if (!p) return
    const have = this.kv.get(PROGRAM)
    const haveVersion = have ? (JSON.parse(have) as { version: number }).version : -1
    if (p.version !== haveVersion) {
      this.kv.set(PROGRAM, JSON.stringify({ version: p.version, program: p.program }))
      this.revision++
    }
  }
}
