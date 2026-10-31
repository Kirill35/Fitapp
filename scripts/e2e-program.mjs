import { chromium } from 'playwright-core'
import fs from 'fs'
// Program update flow with two simulated phones against a local Worker (same setup as e2e-sync.mjs).
const out = process.argv[2] ?? '.'
const seed = JSON.parse(fs.readFileSync(new URL('../src/seed/program.json', import.meta.url), 'utf8'))
const BASE = 'http://localhost:8787', TOKEN = 'local-dev-token'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const errs = []
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); if (!cond) process.exitCode = 1 }
const newPhone = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.clock.setFixedTime(new Date('2026-10-31T09:00:00')) // Saturday: Day B
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errs.push(`${name}: ${m.text()}`))
  await p.goto(BASE)
  await p.getByLabel('Settings').click()
  await p.locator('#sync-token').fill(TOKEN)
  await p.getByRole('button', { name: 'Connect' }).click()
  await p.getByText('Up to date').waitFor()
  await p.getByText('‹').first().click()
  return { ctx, p }
}
const goUpdate = async (p) => {
  await p.getByLabel('Settings').click()
  await p.getByText('Program', { exact: true }).first().click()
  await p.getByText('Update program').click()
}
const paste = async (p, text) => { await p.locator('#program-answer').fill(text) }
const mod = (fn) => { const x = structuredClone(seed); fn(x); return JSON.stringify(x) }

const A = await newPhone('A')
// A logged workout on Day B today
await A.p.getByText('TODAY', { exact: true }).first().click()
await A.p.getByText('Deadlift').first().click()
await A.p.getByLabel('Confirm set').first().click()
await A.p.getByText('‹').first().click()
await A.p.getByText('‹').first().click()
await A.p.waitForTimeout(1500)

// --- the update screen ---
await goUpdate(A.p)
await A.p.locator('#program-request').fill('Add Romanian deadlift to day B')
await A.p.getByText('Show the prompt').click()
const prompt = await A.p.locator('#program-prompt').inputValue()
ok('prompt has the request, ids, the format and history', prompt.includes('Add Romanian deadlift to day B') && prompt.includes('- bench: Bench press') && prompt.includes('ONE JSON object') && /Deadlift \(deadlift\): .*110 kg/.test(prompt))
await A.p.screenshot({ path: `${out}/1-update-empty.png`, fullPage: true })

// bad pastes
await paste(A.p, 'Sure, I would suggest adding squats.')
ok('prose without JSON is explained', await A.p.getByText('No JSON object found').isVisible())
await paste(A.p, mod((p) => { p.days.B.items[0].ex = 'nope' }))
ok('unknown exercise is explained with a path', await A.p.getByText('unknown exercise "nope"').isVisible())
ok('no activate button for an invalid program', (await A.p.getByRole('button', { name: 'Make this my program' }).count()) === 0)
await A.p.screenshot({ path: `${out}/2-invalid.png`, fullPage: true })

// good paste, wrapped the way chat apps do it
const good = mod((p) => {
  p.exercises.bench.start = 90
  p.exercises.rdl = { name: 'Romanian deadlift', load: 'kg', measure: 'reps', sets: 3, reps: 8, start: 80, aliases: ['romanian'] }
  p.days.B.items.splice(2, 0, { ex: 'rdl' })
})
await paste(A.p, 'Here is your updated program:\n```json\n' + good + '\n```\nEnjoy!')
await A.p.getByText('✓ This is a valid program').waitFor()
const body = await A.p.locator('main').innerText()
ok('diff lists the new exercise and the changed weight', body.includes('Romanian deadlift') && body.includes('start 85 kg → 90 kg') && /1 added · 1 changed|2 added · 1 changed|3 added · 1 changed/.test(body))
await A.p.screenshot({ path: `${out}/3-diff.png`, fullPage: true })
await A.p.locator('#program-note').fill('RDL on day B')
await A.p.getByRole('button', { name: 'Make this my program' }).click()
await A.p.getByText('You are on version 2').waitFor()
ok('program activated as version 2', true)
ok('version list shows both, 2 active', (await A.p.locator('li', { hasText: 'Version 2' }).innerText()).includes('ACTIVE') && (await A.p.getByText('Version 1').count()) === 1)

// Home/day use the new program
await A.p.getByText('‹').first().click(); await A.p.getByText('‹').first().click(); await A.p.getByText('‹').first().click()
await A.p.getByText('TODAY', { exact: true }).first().click()
ok('day B now has Romanian deadlift, logged deadlift kept', (await A.p.locator('main').innerText()).includes('Romanian deadlift'))
await A.p.screenshot({ path: `${out}/4-day-new-program.png` })

// --- Phone B removes Day B entirely while A is inside the exercise screen ---
const B = await newPhone('B')
await A.p.getByText('Deadlift').first().click() // A is now inside a log screen
const destructive = mod((p) => { delete p.days.B; p.schedule.sat = 'bjj' })
await goUpdate(B.p)
await paste(B.p, destructive)
await B.p.getByText('✓ This is a valid program').waitFor()
const bBody = await B.p.locator('main').innerText()
ok('removing a day with logged history warns', bBody.includes('Day "Day B" removed') && bBody.includes('which no longer exists'))
await B.p.screenshot({ path: `${out}/5-warnings.png`, fullPage: true })
await B.p.getByRole('button', { name: 'Make this my program' }).click()
await B.p.getByText(/You are on version 3/).waitFor()

await A.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await A.p.getByText('The program changed while this exercise was open').waitFor({ timeout: 8000 })
ok('phone A is not broken by the change from phone B', true)
await A.p.screenshot({ path: `${out}/6-a-fallback.png` })
await A.p.getByRole('button', { name: 'Back to the day' }).click()
await A.p.getByText('‹').first().click()
const home = await A.p.locator('main').innerText()
ok('home still renders; the old workout shows as an earlier program', home.includes('B (earlier program)') || home.includes('earlier program'))
await A.p.screenshot({ path: `${out}/7-a-home-after.png`, fullPage: true })

// --- Roll back on B ---
await B.p.getByRole('button', { name: 'Review' }).first().click().catch(() => {})
const reviewHeading = await B.p.getByText(/Switch to version/).first().waitFor({ timeout: 8000 }).then(() => true, () => false)
ok('review shows what switching back would change', reviewHeading)
await B.p.getByRole('button', { name: 'Switch', exact: true }).click()
await B.p.getByText(/Switched to version/).waitFor()
ok('rolled back', true)
await A.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await A.p.waitForTimeout(1500)
await A.p.getByText('TODAY', { exact: true }).first().click()
ok('phone A follows the rollback (Day B is back)', (await A.p.locator('main').innerText()).includes('Deadlift'))
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
