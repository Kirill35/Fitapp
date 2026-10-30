import { chromium } from 'playwright-core'
// Two simulated phones against a running local Worker (npm run dev:api with API_TOKEN=local-dev-token and a fresh database).
// Usage: CHROME_PATH=/path/to/chrome node scripts/e2e-sync.mjs ./screenshots   (needs: npm i -D playwright-core)
const out = process.argv[2] ?? '.'
const BASE = 'http://localhost:8787'
const TOKEN = 'local-dev-token'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const errs = []
const newPhone = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'allow' })
  await ctx.clock.setFixedTime(new Date('2026-10-31T09:00:00')) // Saturday: Day B
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errs.push(`${name}: ${m.text()}`))
  await p.goto(BASE)
  return { ctx, p }
}
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) process.exitCode = 1 }
const dot = (p) => p.locator('[role=status][title]').first().getAttribute('title').catch(() => null)
const waitDot = async (p, re) => { for (let i = 0; i < 40; i++) { const t = await dot(p); if (t && re.test(t)) return t; await p.waitForTimeout(250) } return await dot(p) }

// --- Phone A: connect, log a set ---
const A = await newPhone('A')
ok('home shows no sync dot before connecting', (await dot(A.p)) === null)
await A.p.getByLabel('Settings').click()
await A.p.screenshot({ path: `${out}/1-settings-unconnected.png`, fullPage: true })
await A.p.locator('#sync-token').fill('wrong-token')
await A.p.getByRole('button', { name: 'Connect' }).click()
await A.p.getByText('did not accept the token').waitFor()
ok('wrong token is reported', true)
await A.p.getByRole('button', { name: 'Disconnect' }).click()
await A.p.locator('#sync-token').fill(TOKEN)
await A.p.getByRole('button', { name: 'Connect' }).click()
await A.p.getByText('Up to date').waitFor()
ok('right token connects and syncs', true)
await A.p.getByText('‹').first().click()
ok('home shows a synced dot', /Synced/.test((await waitDot(A.p, /Synced/)) ?? ''))

await A.p.getByText('TODAY', { exact: true }).first().click()
await A.p.getByText('Deadlift').first().click()
await A.p.getByLabel('Confirm set').first().click()
await A.p.getByRole('button', { name: /^Right/ }).click()
await A.p.getByText('‹').first().click()
await A.p.waitForTimeout(2500) // debounce + upload
const sv = await (await fetch(`${BASE}/api/sessions?since=0`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
ok('server received the session', sv.sessions.length === 1 && sv.sessions[0].exercises.deadlift.sets[0].done === true)
ok('session carries the program version', sv.sessions[0].programVersion === 1)

// --- Phone B: a fresh phone connects and sees it ---
const B = await newPhone('B')
await B.p.getByLabel('Settings').click()
await B.p.locator('#sync-token').fill(TOKEN)
await B.p.getByRole('button', { name: 'Connect' }).click()
await B.p.getByText('Up to date').waitFor()
await B.p.getByText('‹').first().click()
await B.p.getByText('TODAY', { exact: true }).first().click()
await B.p.screenshot({ path: `${out}/2-phone-b-day.png`, fullPage: true })
const body = await B.p.locator('main').innerText()
ok('phone B shows what phone A logged', /Today\s+110 kg · 5/.test(body) && /Right/.test(body))

// --- Phone A: offline, reload, keep logging ---
await A.ctx.setOffline(true)
await A.p.reload()
await A.p.getByText('Day B').first().waitFor({ timeout: 10000 })
ok('app opens offline from the installed cache', true)
await A.p.getByText('TODAY', { exact: true }).first().click()
await A.p.getByText('Jump shrug').first().click()
await A.p.getByLabel('Confirm set').first().click()
await A.p.getByText('‹').first().click()
await A.p.waitForTimeout(2000)
await A.p.getByText('‹').first().click()
const offlineDot = await waitDot(A.p, /Offline|Waiting/)
ok(`offline state is shown (${offlineDot})`, /Offline|Waiting/.test(offlineDot ?? ''))
await A.p.screenshot({ path: `${out}/3-offline-home.png` })
await A.ctx.setOffline(false)
await A.p.evaluate(() => window.dispatchEvent(new Event('online')))
ok('after reconnecting it uploads by itself', /Synced/.test((await waitDot(A.p, /Synced/)) ?? ''))
const sv2 = await (await fetch(`${BASE}/api/sessions?since=0`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
ok('server now has the offline edit', sv2.sessions[0].exercises['jump-shrug']?.sets[0].done === true)

// --- Phone B pulls it when it returns to the app ---
await B.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await B.p.waitForTimeout(1500)
const bBody = await B.p.locator('main').innerText()
await B.p.screenshot({ path: `${out}/4-phone-b-after-pull.png`, fullPage: true })
ok('phone B picked up the new set without a reload', /Jump shrug[\s\S]*?Today\s+40 kg/.test(bBody))
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
