import { beforeEach, describe, expect, test } from 'vitest'
import seed from '../seed/program.json'
import { createApp, type Env } from '../../worker/index'
import { createTestDb } from '../../worker/test-d1'
import { memoryKV, type KV } from './kv'
import { LocalStorageRepository } from './LocalStorageRepository'
import { SyncedRepository } from './SyncedRepository'
import type { Session } from '../domain/types'

const TOKEN = 'secret'
const app = createApp()
let env: Env

/** A fake network between a phone and the server, with switches to break it. */
class Net {
  offline = false
  /** The server processes the request, but the phone never hears back. */
  dropReplies = false
  beforePut?: () => void
  puts = 0
  /** Replace to simulate something other than the server answering. */
  override?: typeof fetch
  fetch: typeof fetch = async (input, init) => {
    if (this.override) return this.override(input, init)
    if (this.offline) throw new TypeError('network down')
    const url = String(input)
    if ((init?.method ?? 'GET') === 'PUT') {
      this.puts++
      this.beforePut?.()
    }
    const res = await app.fetch(new Request(`http://server${url}`, init), env)
    if (this.dropReplies) throw new TypeError('connection lost')
    return res
  }
}

let t = 0
const clock = () => new Date(Date.UTC(2026, 9, 13, 10, 0, t++)).toISOString() // each call is one second later

function phone(net: Net, token: string | null = TOKEN) {
  const kv = memoryKV()
  if (token) kv.set('liftlog.token.v1', token)
  const repo = new SyncedRepository(new LocalStorageRepository(kv, clock), kv, { fetch: net.fetch, debounceMs: 60_000 })
  return { repo, kv, net }
}

const session = (kg: number, date = '2026-10-13', dayId = 'A'): Session => ({
  id: `${date}:${dayId}`,
  date,
  dayId,
  blockId: 'B1',
  status: 'in-progress',
  exercises: { bench: { sets: [{ kg, value: 5, done: true }] } },
  updatedAt: '',
})
const kgOf = async (r: SyncedRepository, id = '2026-10-13:A') => (await r.listSessions()).find((s) => s.id === id)?.exercises.bench.sets[0].kg
const serverKg = async (id = '2026-10-13:A') => {
  const rows = await env.DB.prepare('SELECT data FROM sessions WHERE id = ?').bind(id).all<{ data: string }>()
  return rows.results.length ? JSON.parse(rows.results[0].data).exercises.bench.sets[0].kg : undefined
}

beforeEach(() => {
  env = { DB: createTestDb(), API_TOKEN: TOKEN }
  t = 0
})

describe('one phone', () => {
  test('without a token nothing leaves the phone', async () => {
    const net = new Net()
    const { repo } = phone(net, null)
    await repo.saveSession(session(85))
    await repo.sync.syncNow()
    expect(net.puts).toBe(0)
    expect(repo.info().state).toBe('local')
    expect(await kgOf(repo)).toBe(85)
  })

  test('saves go to the server and the queue empties', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    expect(repo.info()).toMatchObject({ state: 'pending', pending: 1 })
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'synced', pending: 0 })
    expect(await serverKg()).toBe(85)
  })

  test('logging with no signal works, and uploads once the connection returns', async () => {
    const net = new Net()
    const { repo } = phone(net)
    net.offline = true
    await repo.saveSession(session(85))
    await repo.saveSession(session(87.5)) // second edit of the same session while offline
    await repo.saveSession(session(100, '2026-10-17', 'B'))
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'offline', pending: 2 })
    expect(await kgOf(repo)).toBe(87.5) // the phone still shows everything
    expect(await serverKg()).toBeUndefined()

    net.offline = false
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'synced', pending: 0 })
    expect(await serverKg()).toBe(87.5)
    expect(await serverKg('2026-10-17:B')).toBe(100)
    expect(net.puts).toBe(2) // the repeated edit was one upload
  })

  test('the outbox survives an app restart', async () => {
    const net = new Net()
    const a = phone(net)
    net.offline = true
    await a.repo.saveSession(session(85))
    // "Restart": a new repository over the same storage.
    const repo2 = new SyncedRepository(new LocalStorageRepository(a.kv, clock), a.kv, { fetch: net.fetch, debounceMs: 60_000 })
    expect(repo2.info().pending).toBe(1)
    net.offline = false
    await repo2.sync.syncNow()
    expect(await serverKg()).toBe(85)
  })

  test('if the reply is lost after the server saved, retrying changes nothing', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    net.dropReplies = true
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'offline', pending: 1 })
    expect(await serverKg()).toBe(85) // it did arrive
    net.dropReplies = false
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'synced', pending: 0 })
    expect(await kgOf(repo)).toBe(85)
  })

  test('an edit made while an upload is in flight is not lost', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    let edited = false
    net.beforePut = () => {
      if (edited) return
      edited = true
      void repo.saveSession(session(90)) // the user taps again during the upload
    }
    await repo.sync.syncNow()
    await repo.sync.syncNow()
    expect(await serverKg()).toBe(90)
    expect(repo.info().pending).toBe(0)
  })

  test('a wrong token stops syncing and says so; the data stays on the phone', async () => {
    const net = new Net()
    const { repo } = phone(net, 'wrong')
    await repo.saveSession(session(85))
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'unauthorized', pending: 1 })
    expect(await kgOf(repo)).toBe(85)
    repo.setToken(TOKEN)
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'synced', pending: 0 })
  })

  test('a session the server refuses is dropped from the queue and reported, others still upload', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession({ ...session(85), exercises: { bench: { sets: [{ kg: 5000, value: 5, done: true }] } } }) // over the limit
    await repo.saveSession(session(100, '2026-10-17', 'B'))
    await repo.sync.syncNow()
    expect(repo.info().state).toBe('error')
    expect(repo.info().error).toContain('refused')
    expect(repo.info().pending).toBe(0)
    expect(await serverKg('2026-10-17:B')).toBe(100)
  })

  test('import queues everything and validates before changing anything', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.importData(JSON.stringify({ sessions: [{ ...session(85), updatedAt: '2026-09-01T10:00:00.000Z' }] }))
    expect(repo.info().pending).toBe(1)
    await expect(repo.importData(JSON.stringify({ sessions: [{ nope: 1 }] }))).rejects.toThrow('not valid')
    await repo.sync.syncNow()
    expect(await serverKg()).toBe(85)
  })
})

describe('two phones', () => {
  test('a session logged on one shows up on the other', async () => {
    const net = new Net()
    const a = phone(net)
    const b = phone(net)
    await a.repo.saveSession(session(85))
    await a.repo.sync.syncNow()
    expect(await kgOf(b.repo)).toBeUndefined()
    const rev = b.repo.info().revision
    await b.repo.sync.syncNow()
    expect(await kgOf(b.repo)).toBe(85)
    expect(b.repo.info().revision).toBeGreaterThan(rev) // tells the UI to reload
  })

  test('the later edit wins on both, whichever phone syncs first', async () => {
    const net = new Net()
    const a = phone(net)
    const b = phone(net)
    await a.repo.saveSession(session(85))
    await a.repo.sync.syncNow()
    await b.repo.sync.syncNow()

    net.offline = true
    await a.repo.saveSession(session(87.5)) // earlier
    await b.repo.saveSession(session(90)) // later
    net.offline = false

    await b.repo.sync.syncNow() // the later edit reaches the server first
    await a.repo.sync.syncNow() // the earlier edit must not overwrite it
    await b.repo.sync.syncNow()
    expect(await serverKg()).toBe(90)
    expect(await kgOf(a.repo)).toBe(90)
    expect(await kgOf(b.repo)).toBe(90)
    expect(a.repo.info().pending).toBe(0)
  })

  test('different days edited on each phone both survive', async () => {
    const net = new Net()
    const a = phone(net)
    const b = phone(net)
    await a.repo.saveSession(session(85, '2026-10-13', 'A'))
    await b.repo.saveSession(session(110, '2026-10-17', 'B'))
    for (const p of [a, b, a]) await p.repo.sync.syncNow()
    expect(await kgOf(a.repo, '2026-10-17:B')).toBe(110)
    expect(await kgOf(b.repo, '2026-10-13:A')).toBe(85)
  })

  test('a new phone downloads the whole history, in pages', async () => {
    const net = new Net()
    const a = phone(net)
    for (let d = 1; d <= 9; d++) await a.repo.saveSession(session(80 + d, `2026-11-0${d}`, 'A'))
    await a.repo.sync.syncNow()
    const b = phone(net)
    await b.repo.sync.syncNow()
    expect((await b.repo.listSessions()).length).toBe(9)
    expect(b.kv.get('liftlog.cursor.v1')).toBe('9')
  })
})

describe('program', () => {
  test('starts on the bundled program, then follows the server', async () => {
    const net = new Net()
    const { repo } = phone(net)
    expect((await repo.getProgram()).version).toBe(0)
    await repo.sync.syncNow()
    const first = await repo.getProgram()
    expect(first.version).toBe(1)

    const next = structuredClone(seed) as any
    next.exercises.bench.start = 90
    await app.fetch(new Request('http://s/api/program', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ program: next }) }), env)
    const rev = repo.info().revision
    await repo.sync.syncNow()
    const p = await repo.getProgram()
    expect(p.version).toBe(2)
    expect(p.program.exercises.bench.start).toBe(90)
    expect(repo.info().revision).toBeGreaterThan(rev)
  })

  test('the cached program is available offline', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.sync.syncNow()
    net.offline = true
    expect((await repo.getProgram()).version).toBe(1)
  })

  test('a damaged cached program falls back to the bundled one instead of breaking the app', async () => {
    const net = new Net()
    const { repo, kv } = phone(net)
    kv.set('liftlog.program.v1', '{"version": 5, "program": {"start": 1}}')
    expect((await repo.getProgram()).version).toBe(0)
  })
})

describe('changing the program', () => {
  const changed = (fn: (p: any) => void) => {
    const p = structuredClone(seed) as any
    fn(p)
    return p
  }

  test('a new version becomes the active program on this phone and on another one', async () => {
    const net = new Net()
    const a = phone(net)
    const b = phone(net)
    await a.repo.sync.syncNow()
    await b.repo.sync.syncNow()
    const notified = { n: 0 }
    a.repo.subscribe(() => notified.n++)
    const rev = a.repo.info().revision

    const v = await a.repo.programs.save(changed((p) => (p.exercises.bench.start = 90)), { source: 'ai', note: 'bench up' })
    expect(v).toBe(2)
    expect((await a.repo.getProgram()).program.exercises.bench.start).toBe(90)
    expect(a.repo.info().revision).toBeGreaterThan(rev) // the app reloads the program
    expect(notified.n).toBeGreaterThan(0)

    await b.repo.sync.syncNow()
    expect((await b.repo.getProgram()).version).toBe(2)
  })

  test('versions are listed and an older one can be restored', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.sync.syncNow()
    await repo.programs.save(changed((p) => (p.exercises.bench.start = 90)), { source: 'ai' })
    const list = await repo.programs.list()
    expect(list.map((x) => [x.version, x.source, x.active])).toEqual([[2, 'ai', true], [1, 'seed', false]])
    expect((await repo.programs.get(1)).exercises.bench.start).toBe(85)

    await repo.programs.activate(1)
    expect((await repo.getProgram()).version).toBe(1)
    expect((await repo.getProgram()).program.exercises.bench.start).toBe(85)
    expect((await repo.programs.list()).find((x) => x.active)?.version).toBe(1)
  })

  test('a program the server refuses is explained, and nothing changes', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.sync.syncNow()
    const bad = changed((p) => (p.days.A.items[0].ex = 'nope'))
    await expect(repo.programs.save(bad, { source: 'ai' })).rejects.toThrow('unknown exercise "nope"')
    expect((await repo.getProgram()).version).toBe(1)
    expect((await repo.programs.list()).length).toBe(1)
  })

  test('without a connection, or without a token, it says what to do', async () => {
    const net = new Net()
    const { repo } = phone(net)
    net.offline = true
    await expect(repo.programs.save(seed as never, { source: 'ai' })).rejects.toThrow('needs the internet')
    const local = phone(net, null)
    expect(local.repo.programs.available()).toBe(false)
    await expect(local.repo.programs.list()).rejects.toThrow('Connect this phone')
  })

  test('logged workouts keep working after the program changes under them', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    await repo.sync.syncNow()
    await repo.programs.save(changed((p) => { delete p.days.A; p.schedule.tue = 'bjj' }), { source: 'ai' })
    expect(await kgOf(repo)).toBe(85) // the old workout is still there
    await repo.sync.syncNow()
    expect(repo.info().state).toBe('synced')
  })
})

describe('network edge cases', () => {
  test('an HTML page instead of the API (captive portal, hosting error) counts as offline, not as success', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    net.override = async () => new Response('<html>Sign in to Wi-Fi</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'offline', pending: 1 })
  })

  test('a server error is retried later, not treated as permanent', async () => {
    const net = new Net()
    const { repo } = phone(net)
    await repo.saveSession(session(85))
    net.override = async () => new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } })
    await repo.sync.syncNow()
    expect(repo.info()).toMatchObject({ state: 'offline', pending: 1 })
  })
})

describe('local store', () => {
  test('edit times never go backwards, even if the clock does', async () => {
    const kv: KV = memoryKV()
    const local = new LocalStorageRepository(kv, () => '2026-10-13T10:00:00.000Z') // frozen clock
    await local.saveSession(session(85))
    const first = local.get('2026-10-13:A')!.updatedAt
    await local.saveSession(session(86))
    expect(local.get('2026-10-13:A')!.updatedAt > first).toBe(true)
  })
})
