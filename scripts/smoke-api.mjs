// Usage: API_TOKEN=... node scripts/smoke-api.mjs [baseUrl]
// Checks a running server (local `wrangler dev` or the deployed Worker). Read-only unless --write is given;
// --write saves one test session dated 2099-01-01 (there is no delete endpoint, by design).
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '')
const token = process.env.API_TOKEN
const write = process.argv.includes('--write')
if (!token) throw new Error('Set API_TOKEN')

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`)
  if (!ok) failed++
}
const req = (path, init = {}, auth = true) =>
  fetch(base + path, { ...init, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...init.headers } })

check('health is open', (await req('/api/health', {}, false)).status === 200)
check('no token is refused', (await req('/api/sessions', {}, false)).status === 401)
check('wrong token is refused', (await fetch(base + '/api/sessions', { headers: { Authorization: 'Bearer nope' } })).status === 401)
const sessions = await req('/api/sessions?since=0&limit=1')
check('sessions readable', sessions.status === 200, String(sessions.status))
const program = await req('/api/program')
const pj = await program.json()
check('active program readable and valid shape', program.status === 200 && !!pj.program?.blocks?.length)
const shell = await fetch(base + '/')
check('app shell served', shell.status === 200 && (shell.headers.get('content-type') ?? '').includes('text/html'))
const spa = await fetch(base + '/some/route')
check('unknown page falls back to the app', spa.status === 200 && (spa.headers.get('content-type') ?? '').includes('text/html'))

if (write) {
  const id = '2099-01-01:smoke'
  const body = { id, date: '2099-01-01', dayId: 'smoke', blockId: null, status: 'in-progress', exercises: {}, updatedAt: new Date().toISOString() }
  const put = await req(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  check('write session', put.status === 200, String(put.status))
  const back = await (await req('/api/sessions?since=0&limit=500')).json()
  check('written session comes back', back.sessions.some((s) => s.id === id))
  console.log('note: the test session 2099-01-01:smoke stays in the database (dated far in the future, ignored by the app).')
}
process.exit(failed ? 1 : 0)
