import seed from '../seed/program.json'
import { checkProgram, SessionSchema } from '../../shared/schema'
import type { Session } from '../domain/types'
import { browserKV, type KV } from './kv'
import type { ProgramInfo, WorkoutRepository } from './WorkoutRepository'

const KEY = 'liftlog.sessions.v1'

/** Validate a backup file (the app's export, or a plain list of sessions). */
export function parseBackup(json: string): Session[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('This is not valid JSON.')
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { sessions?: unknown } | null)?.sessions
  if (!Array.isArray(list)) throw new Error('This file is not a Lift Log backup.')
  return list.map((item, i) => {
    const r = SessionSchema.safeParse(item)
    if (!r.success) throw new Error(`Session #${i + 1} in the file is not valid. Nothing was imported.`)
    return r.data
  })
}

export class LocalStorageRepository implements WorkoutRepository {
  constructor(
    private kv: KV = browserKV(),
    private now: () => string = () => new Date().toISOString(),
  ) {}

  private load(): Record<string, Session> {
    try {
      const raw = this.kv.get(KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }

  private store(all: Record<string, Session>) {
    this.kv.set(KEY, JSON.stringify(all))
  }

  async getProgram(): Promise<ProgramInfo> {
    const r = checkProgram(seed)
    if (!r.ok) throw new Error(`Program is invalid:\n${r.errors.join('\n')}`)
    return { version: 0, program: r.program }
  }

  async listSessions(): Promise<Session[]> {
    return Object.values(this.load())
  }

  get(id: string): Session | undefined {
    return this.load()[id]
  }

  /** Stamps the edit time, never earlier than the previous edit, so the server always sees a newer value. */
  async saveSession(session: Session): Promise<void> {
    const all = this.load()
    const prev = all[session.id]?.updatedAt
    let stamp = this.now()
    if (prev && stamp <= prev) stamp = new Date(Date.parse(prev) + 1).toISOString()
    all[session.id] = { ...session, updatedAt: stamp }
    this.store(all)
  }

  /** Store sessions exactly as received (keeps their timestamps). Only newer-than-local ones are applied. */
  applyRemote(sessions: Session[]): number {
    const all = this.load()
    let n = 0
    for (const s of sessions) {
      const cur = all[s.id]
      if (!cur || s.updatedAt > cur.updatedAt) {
        all[s.id] = s
        n++
      }
    }
    if (n) this.store(all)
    return n
  }

  async exportData(): Promise<string> {
    return JSON.stringify({ app: 'lift-log', version: 1, exportedAt: this.now(), sessions: Object.values(this.load()) }, null, 2)
  }

  async importData(json: string): Promise<void> {
    this.applyRemote(parseBackup(json))
  }

  async clearSessions(): Promise<void> {
    this.store({})
  }
}
