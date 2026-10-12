// Turns the single-file build into a page fragment for the hosted preview link.
import fs from 'fs'
const [src, dst] = process.argv.slice(2)
const html = fs.readFileSync(src, 'utf8')
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
const keep = [...head.matchAll(/<title>[\s\S]*?<\/title>|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g)].map((m) => m[0])
const title = keep.find((k) => k.startsWith('<title')) ?? '<title>Lift Log</title>'
fs.writeFileSync(dst, [title, ...keep.filter((k) => !k.startsWith('<title')), body].join('\n'))
