import { checkProgram, SessionSchema, type Program, type Session } from '../../shared/schema'

/** kind: network (no answer / timeout), auth (token refused), http (any other error status). */
export class ApiError extends Error {
  constructor(
    readonly kind: 'network' | 'auth' | 'http',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
  /** Worth retrying later without changing anything. */
  get transient() {
    return this.kind === 'network' || (this.kind === 'http' && (this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500))
  }
}

export interface ApiOptions {
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export class ApiClient {
  private f: typeof fetch
  constructor(
    private token: string,
    private opts: ApiOptions = {},
  ) {
    this.f = opts.fetch ?? ((...a) => fetch(...a))
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000)
    let res: Response
    try {
      res = await this.f((this.opts.baseUrl ?? '') + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch {
      throw new ApiError('network', 'No connection to the server')
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 401 || res.status === 403) throw new ApiError('auth', 'The server did not accept the token', res.status)
    // A hosting error page or captive portal is HTML, not our API.
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
    if (!isJson) throw new ApiError(res.status >= 500 || res.ok ? 'network' : 'http', `Unexpected reply (${res.status})`, res.status)
    const data = (await res.json().catch(() => null)) as { error?: string; details?: string[] } | null
    if (!res.ok) throw new ApiError('http', data?.error ?? `Server error ${res.status}`, res.status)
    return data
  }

  async putSession(s: Session): Promise<{ applied: boolean; session?: Session }> {
    const r = (await this.call('PUT', `/api/sessions/${encodeURIComponent(s.id)}`, s)) as { applied: boolean; session?: unknown }
    const stored = r.session ? SessionSchema.safeParse(r.session) : null
    return { applied: !!r.applied, session: stored?.success ? stored.data : undefined }
  }

  async sessionsSince(since: number, limit = 200): Promise<{ sessions: Session[]; cursor: number; more: boolean }> {
    const r = (await this.call('GET', `/api/sessions?since=${since}&limit=${limit}`)) as { sessions: unknown[]; cursor: number; more: boolean }
    // Ignore (rather than crash on) anything that does not match the schema.
    const sessions = r.sessions.flatMap((x) => {
      const p = SessionSchema.safeParse(x)
      return p.success ? [p.data] : []
    })
    return { sessions, cursor: r.cursor, more: r.more }
  }

  async getProgram(): Promise<{ version: number; program: Program } | null> {
    const r = (await this.call('GET', '/api/program')) as { version: number; program: unknown } | null
    const check = checkProgram(r?.program)
    return r && check.ok ? { version: r.version, program: check.program } : null
  }
}
