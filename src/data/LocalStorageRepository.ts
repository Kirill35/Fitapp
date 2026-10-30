import seed from '../seed/program.json'
import { checkProgram } from '../../shared/schema'
import type { Program, Session } from '../domain/types'
import type { WorkoutRepository } from './WorkoutRepository'

const KEY = 'liftlog.sessions.v1'

// In-memory fallback when storage is unavailable (private mode, sandboxed preview).
let memory: Record<string, Session> = {}

function load(): Record<string, Session> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : memory
  } catch {
    return memory
  }
}

function store(all: Record<string, Session>) {
  memory = all
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* keep in memory */
  }
}

export class LocalStorageRepository implements WorkoutRepository {
  async getProgram(): Promise<Program> {
    const r = checkProgram(seed)
    if (!r.ok) throw new Error(`Program is invalid:\n${r.errors.join('\n')}`)
    return r.program
  }

  async listSessions(): Promise<Session[]> {
    return Object.values(load())
  }

  async saveSession(session: Session): Promise<void> {
    const all = load()
    all[session.id] = { ...session, updatedAt: new Date().toISOString() }
    store(all)
  }

  async exportData(): Promise<string> {
    return JSON.stringify({ app: 'lift-log', version: 1, exportedAt: new Date().toISOString(), sessions: Object.values(load()) }, null, 2)
  }

  async importData(json: string): Promise<void> {
    const parsed = JSON.parse(json)
    const list: Session[] = Array.isArray(parsed) ? parsed : parsed.sessions
    if (!Array.isArray(list) || list.some((s) => !s.id || !s.date || !s.exercises)) {
      throw new Error('This file is not a Lift Log backup.')
    }
    const all = load()
    for (const s of list) all[s.id] = s
    store(all)
  }

  async clearSessions(): Promise<void> {
    store({})
  }
}
