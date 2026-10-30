// A small D1-compatible database on top of Node's built-in SQLite, so API tests run without workerd.
// It implements only what worker/db.ts uses: prepare().bind().first/all/run, batch(), exec().
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type Params = (string | number | null)[]

class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    private params: Params = [],
  ) {}
  bind(...p: Params) {
    return new Stmt(this.db, this.sql, p)
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T) ?? null
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} }
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params)
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:')
  const dir = join(import.meta.dirname, 'migrations')
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, f), 'utf8'))
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    // Like D1, a batch is atomic: all statements apply or none do.
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of stmts) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as D1Database
}
