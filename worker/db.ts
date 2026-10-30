import { SessionSchema, type Program, type Session } from '../shared/schema'

export interface ProgramRow {
  version: number
  source: string
  note: string | null
  createdAt: string
  active: boolean
}

const nextSeq = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM sessions)'

/** Insert or update one session. Older or equal edits lose: the stored copy wins ties. */
export async function upsertSession(db: D1Database, s: Session): Promise<{ applied: boolean; seq: number }> {
  const res = await db
    .prepare(
      `INSERT INTO sessions (id, date, day_id, program_version, status, data, updated_at, seq)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ${nextSeq})
       ON CONFLICT(id) DO UPDATE SET
         date = excluded.date, day_id = excluded.day_id, program_version = excluded.program_version,
         status = excluded.status, data = excluded.data, updated_at = excluded.updated_at, seq = ${nextSeq}
       WHERE excluded.updated_at > sessions.updated_at`,
    )
    .bind(s.id, s.date, s.dayId, s.programVersion ?? null, s.status, JSON.stringify({ blockId: s.blockId, exercises: s.exercises }), s.updatedAt)
    .run()
  const row = await db.prepare('SELECT seq FROM sessions WHERE id = ?').bind(s.id).first<{ seq: number }>()
  return { applied: (res.meta.changes ?? 0) > 0, seq: row?.seq ?? 0 }
}

interface SessionRow {
  id: string
  date: string
  day_id: string
  program_version: number | null
  status: string
  data: string
  updated_at: string
  seq: number
}

function toSession(r: SessionRow): Session {
  const d = JSON.parse(r.data) as Pick<Session, 'blockId' | 'exercises'>
  return SessionSchema.parse({
    id: r.id,
    date: r.date,
    dayId: r.day_id,
    blockId: d.blockId,
    ...(r.program_version === null ? {} : { programVersion: r.program_version }),
    status: r.status,
    exercises: d.exercises,
    updatedAt: r.updated_at,
  })
}

export async function getSession(db: D1Database, id: string): Promise<Session | null> {
  const r = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>()
  return r ? toSession(r) : null
}

export async function sessionsSince(db: D1Database, since: number, limit: number) {
  const { results } = await db
    .prepare('SELECT * FROM sessions WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(since, limit + 1)
    .all<SessionRow>()
  const more = results.length > limit
  const rows = more ? results.slice(0, limit) : results
  return { sessions: rows.map(toSession), cursor: rows.length ? rows[rows.length - 1].seq : since, more }
}

export async function allSessions(db: D1Database): Promise<Session[]> {
  const { results } = await db.prepare('SELECT * FROM sessions ORDER BY date, id').all<SessionRow>()
  return results.map(toSession)
}

// ---- Programs ----

interface ProgramDbRow {
  version: number
  json: string
  source: string
  note: string | null
  created_at: string
  active: number
}
const meta = (r: ProgramDbRow): ProgramRow => ({ version: r.version, source: r.source, note: r.note, createdAt: r.created_at, active: r.active === 1 })

/** Create the first version from the seed if there is none yet. */
export async function ensureProgram(db: D1Database, seed: Program) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM programs').first<{ n: number }>()
  if (n?.n) return
  await db
    .prepare("INSERT INTO programs (json, source, note, created_at, active) VALUES (?, 'seed', 'Initial program', ?, 1)")
    .bind(JSON.stringify(seed), new Date().toISOString())
    .run()
}

export async function activeProgram(db: D1Database) {
  const r = await db.prepare('SELECT * FROM programs WHERE active = 1').first<ProgramDbRow>()
  return r ? { ...meta(r), program: JSON.parse(r.json) as Program } : null
}

export async function getProgram(db: D1Database, version: number) {
  const r = await db.prepare('SELECT * FROM programs WHERE version = ?').bind(version).first<ProgramDbRow>()
  return r ? { ...meta(r), program: JSON.parse(r.json) as Program } : null
}

export async function listPrograms(db: D1Database): Promise<ProgramRow[]> {
  const { results } = await db.prepare('SELECT * FROM programs ORDER BY version DESC').all<ProgramDbRow>()
  return results.map(meta)
}

export async function addProgram(db: D1Database, program: Program, source: 'ai' | 'manual', note: string | null): Promise<number> {
  const now = new Date().toISOString()
  // Deactivate first so the one-active unique index is never violated.
  const [, ins] = await db.batch([
    db.prepare('UPDATE programs SET active = 0 WHERE active = 1'),
    db.prepare('INSERT INTO programs (json, source, note, created_at, active) VALUES (?, ?, ?, ?, 1)').bind(JSON.stringify(program), source, note, now),
  ])
  return ins.meta.last_row_id as number
}

export async function activateProgram(db: D1Database, version: number): Promise<boolean> {
  if (!(await getProgram(db, version))) return false
  await db.batch([db.prepare('UPDATE programs SET active = 0 WHERE active = 1'), db.prepare('UPDATE programs SET active = 1 WHERE version = ?').bind(version)])
  return true
}
