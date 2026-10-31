import type { DayId, Program, Session } from '../domain/types'

export interface ProgramInfo {
  /** 0 = the program bundled with the app (never synced). */
  version: number
  program: Program
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'pending' | 'offline' | 'unauthorized' | 'error'

export interface SyncInfo {
  state: SyncState
  /** Sessions saved on this device and not yet confirmed by the server. */
  pending: number
  lastSync?: string
  error?: string
  /** Increases whenever sync changed local data (new sessions or a new program), so the UI knows to reload. */
  revision: number
}

export interface ProgramVersionInfo {
  version: number
  source: 'seed' | 'ai' | 'manual'
  note: string | null
  createdAt: string
  active: boolean
}

/** Program versions live on the server, so this exists only on repositories that have one. */
export interface ProgramControl {
  /** False until the phone is connected with a token. */
  available(): boolean
  list(): Promise<ProgramVersionInfo[]>
  get(version: number): Promise<Program>
  /** Stores a new version and makes it the active program. Returns its version number. */
  save(program: Program, opts: { source: 'ai' | 'manual'; note?: string }): Promise<number>
  activate(version: number): Promise<void>
}

/** Present only on repositories that talk to a server. */
export interface SyncControl {
  info(): SyncInfo
  subscribe(cb: () => void): () => void
  syncNow(): Promise<void>
  hasToken(): boolean
  setToken(token: string | null): void
}

/**
 * The only way the UI reads or writes data. Swap the implementation
 * (localStorage today, local + server sync in production) without touching the UI.
 */
export interface WorkoutRepository {
  getProgram(): Promise<ProgramInfo>
  /** All logged sessions. Single user, a few hundred sessions a year: small enough to load at once. */
  listSessions(): Promise<Session[]>
  saveSession(session: Session): Promise<void>
  exportData(): Promise<string>
  importData(json: string): Promise<void>
  clearSessions(): Promise<void>
  sync?: SyncControl
  programs?: ProgramControl
}

export const sessionId = (date: string, dayId: DayId) => `${date}:${dayId}`
