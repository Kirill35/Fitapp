import { beforeEach, describe, expect, test } from 'vitest'
import seed from '../src/seed/program.json'
import { createApp, type Env } from './index'
import { createTestDb } from './test-d1'

const TOKEN = 'test-token-123'
let env: Env
const app = createApp()

const call = (method: string, path: string, body?: unknown, token: string | null = TOKEN, e: Env = env) =>
  app.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    e,
  )
const json = async (r: Response) => (await r.json()) as any

const session = (date = '2026-10-13', dayId = 'A', updatedAt = '2026-10-13T10:00:00.000Z', kg = 85) => ({
  id: `${date}:${dayId}`,
  date,
  dayId,
  blockId: 'B1',
  status: 'in-progress',
  exercises: { bench: { sets: [{ kg, value: 5, done: true }], difficulty: 'Right' } },
  updatedAt,
})

beforeEach(() => {
  env = { DB: createTestDb(), API_TOKEN: TOKEN }
})

describe('auth', () => {
  test('health is open, everything else needs the token', async () => {
    expect((await call('GET', '/api/health', undefined, null)).status).toBe(200)
    expect((await call('GET', '/api/sessions', undefined, null)).status).toBe(401)
    expect((await call('GET', '/api/sessions', undefined, 'wrong')).status).toBe(401)
    expect((await call('GET', '/api/sessions', undefined, TOKEN + 'x')).status).toBe(401)
    expect((await call('GET', '/api/sessions')).status).toBe(200)
  })
  test('fails closed when the server has no token', async () => {
    const r = await call('GET', '/api/sessions', undefined, 'anything', { DB: env.DB })
    expect(r.status).toBe(503)
    expect((await call('GET', '/api/health', undefined, null, { DB: env.DB })).status).toBe(200)
  })
  test('responses are not cached', async () => {
    expect((await call('GET', '/api/sessions')).headers.get('cache-control')).toBe('no-store')
  })
})

describe('sessions', () => {
  test('save, then read back with a cursor', async () => {
    const put = await call('PUT', '/api/sessions/2026-10-13:A', session())
    expect(await json(put)).toEqual({ applied: true, seq: 1 })
    const got = await json(await call('GET', '/api/sessions?since=0'))
    expect(got.sessions).toHaveLength(1)
    expect(got.sessions[0]).toEqual(session())
    expect(got.cursor).toBe(1)
    expect(got.more).toBe(false)
    expect((await json(await call('GET', '/api/sessions?since=1'))).sessions).toEqual([])
  })

  test('pushing the same edit twice is harmless', async () => {
    await call('PUT', '/api/sessions/2026-10-13:A', session())
    const again = await json(await call('PUT', '/api/sessions/2026-10-13:A', session()))
    expect(again.applied).toBe(false)
    expect((await json(await call('GET', '/api/sessions'))).cursor).toBe(1) // seq did not move
  })

  test('newer edit wins and moves the cursor; older edit loses and gets the stored copy back', async () => {
    await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T10:00:00.000Z', 85))
    const newer = await json(await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T10:05:00.000Z', 87.5)))
    expect(newer).toEqual({ applied: true, seq: 2 })
    const older = await json(await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T09:00:00.000Z', 80)))
    expect(older.applied).toBe(false)
    expect(older.session.exercises.bench.sets[0].kg).toBe(87.5)
    expect((await json(await call('GET', '/api/sessions'))).sessions[0].exercises.bench.sets[0].kg).toBe(87.5)
  })

  test('timestamps in different spellings compare as times', async () => {
    await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T10:00:00.000Z'))
    // Same instant written without milliseconds: not newer, so not applied.
    const same = await json(await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T10:00:00Z', 99)))
    expect(same.applied).toBe(false)
  })

  test('cursor pages through many sessions in order', async () => {
    for (let d = 1; d <= 5; d++) await call('PUT', `/api/sessions/2026-11-0${d}:A`, session(`2026-11-0${d}`))
    const p1 = await json(await call('GET', '/api/sessions?since=0&limit=2'))
    expect(p1.sessions.map((s: any) => s.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(p1.more).toBe(true)
    const p2 = await json(await call('GET', `/api/sessions?since=${p1.cursor}&limit=2`))
    expect(p2.sessions.map((s: any) => s.date)).toEqual(['2026-11-03', '2026-11-04'])
    const p3 = await json(await call('GET', `/api/sessions?since=${p2.cursor}&limit=2`))
    expect(p3.sessions.map((s: any) => s.date)).toEqual(['2026-11-05'])
    expect(p3.more).toBe(false)
  })

  test('a session another device saved appears for the next pull only', async () => {
    await call('PUT', '/api/sessions/2026-10-13:A', session())
    const cursor = (await json(await call('GET', '/api/sessions'))).cursor
    await call('PUT', '/api/sessions/2026-10-17:B', session('2026-10-17', 'B'))
    await call('PUT', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', '2026-10-13T11:00:00.000Z', 90)) // edit of an old one
    const next = await json(await call('GET', `/api/sessions?since=${cursor}`))
    expect(next.sessions.map((s: any) => s.id)).toEqual(['2026-10-17:B', '2026-10-13:A'])
  })

  test.each([
    ['id does not match the URL', '/api/sessions/2026-10-14:A', session()],
    ['id does not match date and day', '/api/sessions/x:y', { ...session(), id: 'x:y' }],
    ['not a session', '/api/sessions/2026-10-13:A', { hello: 1 }],
    ['negative weight', '/api/sessions/2026-10-13:A', { ...session(), exercises: { bench: { sets: [{ kg: -5, value: 5, done: true }] } } }],
    ['updatedAt is not a date', '/api/sessions/2026-10-13:A', session('2026-10-13', 'A', 'yesterday')],
  ])('rejects: %s', async (_n, path, body) => {
    expect((await call('PUT', path, body)).status).toBe(422)
    expect((await json(await call('GET', '/api/sessions'))).sessions).toEqual([])
  })

  test('rejects broken and oversized bodies', async () => {
    expect((await call('PUT', '/api/sessions/2026-10-13:A', '{nope')).status).toBe(400)
    expect((await call('PUT', '/api/sessions/2026-10-13:A', 'x'.repeat(600_000))).status).toBe(413)
  })

  test('bad paging parameters are refused', async () => {
    for (const q of ['since=-1', 'since=abc', 'limit=0', 'limit=1.5']) expect((await call('GET', `/api/sessions?${q}`)).status).toBe(400)
  })

  test('SQL in values is just text', async () => {
    const s = { ...session(), exercises: { 'x"; DROP TABLE sessions;--': { sets: [{ value: 1, done: true }] } } }
    expect((await call('PUT', '/api/sessions/2026-10-13:A', s)).status).toBe(200)
    expect((await json(await call('GET', '/api/sessions'))).sessions).toHaveLength(1)
  })
})

describe('program', () => {
  test('first read creates version 1 from the seed', async () => {
    const p = await json(await call('GET', '/api/program'))
    expect(p).toMatchObject({ version: 1, source: 'seed', active: true })
    expect(p.program).toEqual(seed)
    expect((await json(await call('GET', '/api/program'))).version).toBe(1) // not duplicated
  })

  test('a valid program becomes the new active version, the old one stays', async () => {
    const next = structuredClone(seed) as any
    next.exercises.bench.start = 90
    const put = await call('PUT', '/api/program', { program: next, note: 'bench up' })
    expect(put.status).toBe(201)
    expect((await json(put)).version).toBe(2)
    const active = await json(await call('GET', '/api/program'))
    expect(active).toMatchObject({ version: 2, source: 'ai', note: 'bench up' })
    expect(active.program.exercises.bench.start).toBe(90)
    const versions = (await json(await call('GET', '/api/program/versions'))).versions
    expect(versions.map((v: any) => [v.version, v.active])).toEqual([[2, true], [1, false]])
    expect((await json(await call('GET', '/api/program/1'))).program.exercises.bench.start).toBe(85)
  })

  test('manual corrections are labelled as manual, and a client cannot claim "seed"', async () => {
    await call('PUT', '/api/program', { program: seed, source: 'manual' })
    await call('PUT', '/api/program', { program: seed, source: 'seed' })
    const v = (await json(await call('GET', '/api/program/versions'))).versions.map((x: any) => x.source)
    expect(v).toEqual(['ai', 'manual', 'seed'])
  })

  test('an invalid program is rejected with readable errors and nothing changes', async () => {
    const bad = structuredClone(seed) as any
    bad.days.A.items[0].ex = 'nope'
    bad.exercises.bench.sets = 0
    const r = await call('PUT', '/api/program', { program: bad })
    expect(r.status).toBe(422)
    const body = await json(r)
    expect(body.details.join('\n')).toContain('unknown exercise "nope"')
    expect(body.details.join('\n')).toContain('exercises.bench.sets')
    expect((await json(await call('GET', '/api/program'))).version).toBe(1)
  })

  test('rollback activates an older version', async () => {
    await call('GET', '/api/program')
    await call('PUT', '/api/program', { program: seed })
    expect((await call('POST', '/api/program/1/activate')).status).toBe(200)
    expect((await json(await call('GET', '/api/program'))).version).toBe(1)
    expect((await call('POST', '/api/program/99/activate')).status).toBe(404)
    expect((await call('POST', '/api/program/abc/activate')).status).toBe(404)
    expect((await call('GET', '/api/program/99')).status).toBe(404)
  })
})

describe('backup', () => {
  test('export, wipe, import restores sessions', async () => {
    await call('PUT', '/api/sessions/2026-10-13:A', session())
    await call('PUT', '/api/sessions/2026-10-17:B', session('2026-10-17', 'B'))
    const dump = await json(await call('GET', '/api/export'))
    expect(dump.sessions).toHaveLength(2)
    expect(dump.programs).toHaveLength(1)

    env = { DB: createTestDb(), API_TOKEN: TOKEN } // fresh server
    const r = await json(await call('POST', '/api/import', dump))
    expect(r).toEqual({ received: 2, applied: 2 })
    expect((await json(await call('GET', '/api/sessions'))).sessions).toHaveLength(2)
    expect((await json(await call('POST', '/api/import', dump))).applied).toBe(0) // importing twice changes nothing
  })

  test('one bad session means nothing is imported', async () => {
    const r = await call('POST', '/api/import', { sessions: [session(), { nope: true }] })
    expect(r.status).toBe(422)
    expect((await json(await call('GET', '/api/sessions'))).sessions).toEqual([])
  })

  test('accepts the app’s own export format (plain list or {sessions})', async () => {
    expect((await json(await call('POST', '/api/import', [session()]))).applied).toBe(1)
    expect((await json(await call('POST', '/api/import', { app: 'lift-log', sessions: [session('2026-10-17', 'B')] }))).applied).toBe(1)
  })
})

describe('routing', () => {
  test('unknown API paths are JSON 404s', async () => {
    const r = await call('GET', '/api/nope')
    expect(r.status).toBe(404)
    expect(await json(r)).toEqual({ error: 'Not found' })
  })
})
