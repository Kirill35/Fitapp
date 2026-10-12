import type { DayId, LastPerformance, Program, Session } from '../domain/types'

/**
 * The only way the UI reads or writes data. Swap the implementation
 * (localStorage today, an HTTP backend later) without touching the UI.
 */
export interface WorkoutRepository {
  getProgram(): Promise<Program>
  /** Sessions logged on a date (normally zero or one). */
  getSessions(date: string): Promise<Session[]>
  saveSession(session: Session): Promise<void>
  /** Most recent logged sets for an exercise strictly before `beforeDate`. */
  getLastPerformance(exerciseId: string, beforeDate: string): Promise<LastPerformance | null>
  exportData(): Promise<string>
  importData(json: string): Promise<void>
  clearSessions(): Promise<void>
}

export const sessionId = (date: string, dayId: DayId) => `${date}:${dayId}`
