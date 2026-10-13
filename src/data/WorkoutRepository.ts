import type { DayId, Program, Session } from '../domain/types'

/**
 * The only way the UI reads or writes data. Swap the implementation
 * (localStorage today, an HTTP backend later) without touching the UI.
 */
export interface WorkoutRepository {
  getProgram(): Promise<Program>
  /** All logged sessions. Single user, a few hundred sessions a year: small enough to load at once. */
  listSessions(): Promise<Session[]>
  saveSession(session: Session): Promise<void>
  exportData(): Promise<string>
  importData(json: string): Promise<void>
  clearSessions(): Promise<void>
}

export const sessionId = (date: string, dayId: DayId) => `${date}:${dayId}`
