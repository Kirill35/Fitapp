import { Hono } from 'hono'
import { checkProgram, SessionSchema, type Session } from '../shared/schema'
import seed from '../src/seed/program.json'
import { activateProgram, activeProgram, addProgram, allSessions, ensureProgram, getProgram, getSession, listPrograms, sessionsSince, upsertSession } from './db'

export interface Env {
  DB: D1Database
  /** Secret. If missing, every /api call except /api/health is refused. */
  API_TOKEN?: string
  ASSETS?: Fetcher
}

const MAX_BODY = 512 * 1024
const MAX_PAGE = 500

/** Compare secrets without leaking length or position of the first difference. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i]
  return diff === 0
}

/** Read a JSON body, refusing anything over the size limit (also when Content-Length lies). */
async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }> {
  const text = await req.text()
  if (text.length > MAX_BODY) return { ok: false, status: 413, error: 'Body too large' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: 'Body is not valid JSON' }
  }
}

/** Normalise the client timestamp so string comparison in SQL orders correctly. */
function normalise(s: Session): Session | null {
  const t = Date.parse(s.updatedAt)
  if (Number.isNaN(t)) return null
  return { ...s, updatedAt: new Date(t).toISOString() }
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', async (c, next) => {
    const token = c.env.API_TOKEN
    if (!token) return c.json({ error: 'Server has no API_TOKEN configured' }, 503)
    const header = c.req.header('Authorization') ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!given || !(await sameSecret(given, token))) return c.json({ error: 'Unauthorized' }, 401)
    c.header('Cache-Control', 'no-store')
    await next()
  })

  // ---- Sessions ----

  app.get('/api/sessions', async (c) => {
    const since = Number(c.req.query('since') ?? 0)
    const limit = Math.min(Number(c.req.query('limit') ?? MAX_PAGE), MAX_PAGE)
    if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1) return c.json({ error: 'Bad since or limit' }, 400)
    return c.json(await sessionsSince(c.env.DB, since, limit))
  })

  app.put('/api/sessions/:id', async (c) => {
    const body = await readJson(c.req.raw)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = SessionSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: 'Invalid session', details: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) }, 422)
    const s = normalise(parsed.data)
    if (!s) return c.json({ error: 'updatedAt is not a date' }, 422)
    if (s.id !== c.req.param('id') || s.id !== `${s.date}:${s.dayId}`) return c.json({ error: 'id must be "<date>:<dayId>" and match the URL' }, 422)
    const { applied, seq } = await upsertSession(c.env.DB, s)
    // When the stored copy is newer, send it back so the client can adopt it.
    return c.json({ applied, seq, ...(applied ? {} : { session: await getSession(c.env.DB, s.id) }) })
  })

  // ---- Program ----

  app.get('/api/program', async (c) => {
    await ensureProgram(c.env.DB, seed as never)
    return c.json(await activeProgram(c.env.DB))
  })

  app.put('/api/program', async (c) => {
    const body = await readJson(c.req.raw)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const b = body.value as { program?: unknown; source?: string; note?: unknown }
    const check = checkProgram(b?.program)
    if (!check.ok) return c.json({ error: 'Program is not valid', details: check.errors }, 422)
    const source = b.source === 'manual' ? 'manual' : 'ai'
    const note = typeof b.note === 'string' ? b.note.slice(0, 300) : null
    await ensureProgram(c.env.DB, seed as never)
    const version = await addProgram(c.env.DB, check.program, source, note)
    return c.json({ version }, 201)
  })

  app.get('/api/program/versions', async (c) => {
    await ensureProgram(c.env.DB, seed as never)
    return c.json({ versions: await listPrograms(c.env.DB) })
  })

  app.get('/api/program/:version', async (c) => {
    const v = Number(c.req.param('version'))
    const p = Number.isInteger(v) ? await getProgram(c.env.DB, v) : null
    return p ? c.json(p) : c.json({ error: 'No such version' }, 404)
  })

  app.post('/api/program/:version/activate', async (c) => {
    const v = Number(c.req.param('version'))
    if (!Number.isInteger(v) || !(await activateProgram(c.env.DB, v))) return c.json({ error: 'No such version' }, 404)
    return c.json({ version: v })
  })

  // ---- Backup ----

  app.get('/api/export', async (c) => {
    await ensureProgram(c.env.DB, seed as never)
    const programs = await Promise.all((await listPrograms(c.env.DB)).map((p) => getProgram(c.env.DB, p.version)))
    return c.json({ app: 'lift-log', version: 1, exportedAt: new Date().toISOString(), sessions: await allSessions(c.env.DB), programs })
  })

  app.post('/api/import', async (c) => {
    const body = await readJson(c.req.raw)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const raw = body.value as { sessions?: unknown } | unknown[]
    const list = Array.isArray(raw) ? raw : raw?.sessions
    if (!Array.isArray(list) || list.length > 5000) return c.json({ error: 'Expected a list of sessions' }, 400)
    const sessions: Session[] = []
    for (const [i, item] of list.entries()) {
      const p = SessionSchema.safeParse(item)
      const s = p.success ? normalise(p.data) : null
      if (!s || s.id !== `${s.date}:${s.dayId}`) return c.json({ error: `Session #${i + 1} is not valid; nothing was imported` }, 422)
      sessions.push(s)
    }
    let applied = 0
    for (const s of sessions) if ((await upsertSession(c.env.DB, s)).applied) applied++
    return c.json({ received: sessions.length, applied })
  })

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404))))
  app.onError((e, c) => {
    console.error(e)
    return c.json({ error: 'Server error' }, 500)
  })
  return app
}

export default createApp()
