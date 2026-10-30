# Lift Log: system design (v1)

Single user, iPhone, gym, often poor signal. Two jobs: **show today**, **log it**. Everything below serves those two.

## Principles
1. **Local first.** The UI reads and writes the on-device copy only. The network never blocks a tap.
2. **The server is a durable second copy plus a sync point**, not a source of live truth. If it is down, nothing visible breaks.
3. **Past data only.** No suggestions or predictions anywhere (your decision). The server stores and syncs; it does not compute advice.
4. **One deployable.** App and API on one origin, one config file, no CORS.

## Architecture

```
iPhone (PWA, installed)                       Cloudflare
┌──────────────────────────────┐   HTTPS   ┌─────────────────────────────┐
│ React UI                     │           │ Worker (Hono)               │
│   └─ WorkoutRepository ◄──┐  │           │   /api/*  (bearer token)    │
│ SyncedRepository          │  │  push/    │   static assets (the PWA)   │
│   ├─ local store ─────────┘  │◄─ pull ──►│            │                │
│   └─ outbox (unsent edits)   │           │            ▼                │
│ service worker (offline)     │           │   D1 (SQLite)               │
└──────────────────────────────┘           └─────────────────────────────┘
```

- **App:** the current Vite + React app, unchanged UI. Only the `WorkoutRepository` implementation changes.
- **API:** one Cloudflare Worker (Hono) that also serves the built app as static assets, so everything shares one origin and one `wrangler.toml`.
- **Storage:** D1.
- **Offline:** service worker caches the app shell. Logging works with no signal and syncs later.

## Data model (D1)

```sql
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,      -- "2026-11-14:B" (date:dayId), same as today
  date            TEXT NOT NULL,         -- local calendar date, YYYY-MM-DD
  day_id          TEXT NOT NULL,
  program_version INTEGER NOT NULL,      -- which program this was logged against
  status          TEXT NOT NULL,         -- in-progress | done
  data            TEXT NOT NULL,         -- JSON: exercises -> sets, difficulty
  updated_at      TEXT NOT NULL,         -- client time, used for conflict resolution
  seq             INTEGER NOT NULL       -- server counter, used as sync cursor
);
CREATE INDEX sessions_seq ON sessions(seq);
CREATE INDEX sessions_date ON sessions(date);

CREATE TABLE programs (
  version    INTEGER PRIMARY KEY AUTOINCREMENT,
  json       TEXT NOT NULL,              -- validated against the shared schema
  source     TEXT NOT NULL,              -- seed | ai | manual
  note       TEXT,
  created_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0  -- exactly one row is 1
);
```

A session is stored as one JSON document. Volume, "last time" and charts are computed in the app: a few hundred sessions a year is small, and this keeps the server free of training logic. If that ever stops being true, sets can be split into their own table without changing the API.

## API
All `/api/*` routes require `Authorization: Bearer <token>`. The token is a Worker secret; the app stores it on the device after you paste it once in Settings.

| Route | Purpose |
|---|---|
| `GET /api/sessions?since=<seq>` | Sessions changed after the cursor, plus the new cursor |
| `PUT /api/sessions/:id` | Upsert one session (see conflicts) |
| `GET /api/program` | Active program `{version, program}` |
| `PUT /api/program` | Validate and store a new version, make it active |
| `GET /api/program/versions` | History, for rollback |
| `POST /api/program/:version/activate` | Roll back or forward |
| `GET /api/export` · `POST /api/import` | Full backup and restore |

## Sync
- Every edit saves to the device first, then goes into an **outbox** (a list of session IDs not yet confirmed by the server).
- **Push** the outbox, then **pull** `since=<cursor>`. Runs on app open, on returning to the foreground, when the connection comes back, and after each saved set (debounced).
- **Conflicts: last write wins per session**, comparing `updated_at`; ties go to the server. With one user, two devices editing the same workout at the same moment is the only real case, and the later edit is the one you want.
- A small dot in the header shows synced / pending / offline. No dialogs.
- The server never deletes sessions. "Delete all logs" stays a dev-only tool.

## Program: JSON, AI-generated, with your corrections
You want AI to generate programs and to be able to correct them. That means the program is **data with a strict schema**, not code. Design:

1. **One shared schema** (`shared/program.schema.ts`, zod). The same validator runs in the app and in the Worker, so a bad program is rejected with a readable error before it can break the Today screen.
2. **Stored as versioned JSON in D1**, seeded from `src/seed/program.json`. "Keep JSON for now" is preserved: it is still one JSON document, but changing it no longer needs a redeploy. Every change creates a new version; sessions record the `program_version` they were logged against, so old workouts still render correctly after the program changes.
3. **AI flow v1 (no AI infrastructure):** Settings → *Program* → "Get a prompt". The app produces a ready-to-paste prompt containing the schema, your current program, your exercise IDs and your recent history summary. You paste it into Claude, get JSON back, paste it into **Import program**. The app validates it, shows a **diff against the current program**, and you tap Activate. Rolling back is one tap.
4. **Corrections** are made in the app on the current version: per exercise start weight, target sets and reps, video URL, aliases. Each save creates a new version marked `manual`. A later AI-generated program is a fresh version; your corrections are visible in the diff rather than silently lost.
5. **AI flow v2 (later, optional):** the Worker calls the Anthropic API directly ("generate next block"). It needs an API key secret and costs money per call; worth doing only after v1 proves useful.

Rules that keep history intact: **exercise IDs are never renamed**; the AI prompt includes the existing ID list and must reuse an ID for the same movement. New movements get new IDs, and "last time" for them is simply empty.

Required refactor before this works: today the model hard-codes two gym days (`'A' | 'B'`) and one cardio day. Generated programs need any number of named training days and any weekly schedule, so `DayId` becomes a string key and the schedule maps weekdays to day keys.

## Security and privacy
- HTTPS only (required for the installed PWA anyway).
- One bearer token, compared in constant time, stored as a Worker secret. Rotating it is one command plus one paste on the phone.
- The static app is public and contains only the seed program. Logs and the active program are served only behind the token.
- No third-party scripts, no analytics. Technique links open YouTube search in a new tab.

## Backups
- **Export JSON** button stays (works offline).
- D1 Time Travel gives point-in-time restore; retention depends on plan, to be confirmed at setup.
- Optional later: a weekly scheduled export to object storage.

## Repo layout
```
src/        app (existing)
worker/     Hono API + D1 queries + migrations
shared/     types and zod schema used by both
docs/       this file
wrangler.toml
```

## Testing
- **Contract tests** for `WorkoutRepository`: the same suite runs against the local implementation and the HTTP/sync implementation.
- **Worker tests** against local D1 (Miniflare): auth, upsert, cursor paging, conflict rule, program validation, version rollback.
- **Sync scenario tests:** log offline then reconnect; two devices editing; interrupted push; duplicate push (idempotent).
- Existing unit tests (calendar, targets, volume, voice) stay and run in CI.

## Delivery steps
| Step | Result you can check |
|---|---|
| 1. Shared schema + `DayId` generalisation ✅ | Current program still renders identically; invalid programs are rejected with clear errors |
| 2. Worker + D1 + auth, local only ✅ | API passes its tests; verified on workerd with a real local D1 |
| 3. `SyncedRepository` + header dot ✅ | Log with airplane mode on, reconnect, data appears on a second browser (`scripts/e2e-sync.mjs`) |
| 4. Deploy to Cloudflare | Installed PWA on your phone, working offline, token set |
| 5. Import program + diff + versions | Paste an AI-generated program, review the diff, activate, roll back |
| 6. Corrections editor | Change a start weight or video link, new version appears |

Steps 1–3 and 5–6 I can build and test here. **Step 4 needs your Cloudflare account**: either you run `npx wrangler deploy` after `wrangler login`, or you add an API token to this session's environment secrets and I run it.

## Decisions made
Web app (installed PWA) · Cloudflare + D1 · program stays JSON, versioned and schema-validated · single bearer token · last write wins per session.

## Open
- AI generation v1 outside the app (paste flow) vs v2 inside the app from day one. Recommended: v1 first.
- Whether corrections should also be possible by voice later ("make deadlift start 115").
