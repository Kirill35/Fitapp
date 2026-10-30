// One-command deploy to Cloudflare. Safe to re-run: it only creates what is missing.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/deploy.mjs
// The app's access token (what you paste in Settings on the phone) is created once and printed once.
// To rotate it later: node scripts/deploy.mjs --rotate-token
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const need = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !process.env[k])
if (need.length) {
  console.error(`Missing environment variable(s): ${need.join(', ')}. See docs/DEPLOY.md.`)
  process.exit(1)
}
const rotate = process.argv.includes('--rotate-token')
const wr = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts })
const step = (s) => console.log(`\n== ${s}`)

step('Checking access')
console.log(wr(['whoami']).split('\n').filter((l) => /account|@|Name/i.test(l)).slice(0, 4).join('\n'))

step('Database')
let toml = readFileSync('wrangler.toml', 'utf8')
const ZERO = '00000000-0000-0000-0000-000000000000'
if (toml.includes(ZERO)) {
  const list = JSON.parse(wr(['d1', 'list', '--json']))
  let id = list.find((d) => d.name === 'lift-log')?.uuid
  if (!id) {
    const out = wr(['d1', 'create', 'lift-log'])
    id = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0]
    if (!id) throw new Error(`Could not read the new database id from:\n${out}`)
    console.log('created database lift-log')
  } else console.log('database lift-log already exists')
  toml = toml.replace(ZERO, id)
  writeFileSync('wrangler.toml', toml)
  console.log(`wrangler.toml now points at ${id} (commit this change)`)
} else console.log('wrangler.toml already has a database id')

step('Migrations (remote)')
console.log(wr(['d1', 'migrations', 'apply', 'lift-log', '--remote']))

step('Build')
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })

step('Deploy')
const out = wr(['deploy'])
console.log(out)
const url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0]
if (!url) console.log('Deployed, but no workers.dev address was printed (custom domain?). Use your own address for the check below.')

step('Access token')
let token = null
const hasSecret = JSON.parse(wr(['secret', 'list', '--format', 'json']) || '[]').some((s) => s.name === 'API_TOKEN')
if (!hasSecret || rotate) {
  token = randomBytes(24).toString('base64url')
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'API_TOKEN'], { input: token, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`Could not set the token:\n${r.stderr}`)
  console.log(hasSecret ? 'token rotated' : 'token created')
} else console.log('token already set (use --rotate-token to replace it)')

if (url && token) {
  step('Smoke test (read-only)')
  const r = spawnSync('node', ['scripts/smoke-api.mjs', url], { env: { ...process.env, API_TOKEN: token }, stdio: 'inherit' })
  if (r.status !== 0) process.exitCode = 1
}

console.log(`\nApp address: ${url ?? '(see above)'}`)
if (token) console.log(`Access token (shown once, paste it in Settings → Sync on each phone):\n${token}`)
