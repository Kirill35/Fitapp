# Lift Log

Minimal workout tracker. Phase 1: front-end prototype only (no backend).

- **Home**: block strip (tap a block to see what changes), Today card, volume (weight × reps) per week/month with a line chart, week-by-week program list with past weeks collapsed.
- **Day**: the day's exercises in order, target sets × reps, what you did last time. Warm-up items have ▶ technique links.
- **Log**: tap an exercise, adjust the pre-filled sets with ± steppers, tick ✓, tap one difficulty, ▶ technique link. Shows today next to last time. No predictions.
- **Voice**: "deadlift 110 kilos 5 5 5 right" fills the sets. Without a set count ("85 kilos 5") it fills the next set. Uses the browser's speech recognition, or type/dictate with the iPhone keyboard mic.
- **Settings**: Program summary, Export / Import JSON. A "Prototype testing only" section lets you pick a preview date and add example history.

## Run

```sh
npm install
npm run dev          # http://localhost:5173, also on your LAN IP
npm run build        # installable offline PWA in dist/
npm run build:single # one self-contained HTML file in dist-single/
npm test             # unit tests (calendar, targets, volume, voice, schema, API)
```

### On your iPhone over Wi-Fi
1. Laptop and phone on the same Wi-Fi.
2. `npm run dev` and note the `Network:` URL it prints (e.g. `http://192.168.1.23:5173`).
3. Open that URL in Safari.
4. To install as an app with offline support: `npm run build && npm run preview`, open the printed `Network:` URL,
   Share → Add to Home Screen. (Offline caching needs HTTPS on a real host; on a LAN it works as a plain web app.)

## Structure

- `src/seed/program.json` — the program (blocks, schedule, exercises, warm-up, cardio text). Edit freely.
  Set `"video": "https://…"` on any exercise to replace the YouTube search link.
- `src/data/WorkoutRepository.ts` — the only interface the UI uses for data.
- `src/data/LocalStorageRepository.ts` — current implementation (localStorage). Swap for an HTTP one later.
- `src/domain/program.ts` — calendar (block, week, deload), targets per block, formatting.
- `src/domain/history.ts` — last time per exercise, volume per week/month.
- `src/domain/voice.ts` — voice phrase parser (pure, tested in `voice.test.ts`).
- `src/ui/` — Home, Day, Log, Voice, Settings, Program views.

See `docs/DESIGN.md` for the backend and sync design.

## Backend (local)

```sh
echo "API_TOKEN=local-dev-token" > .dev.vars     # git-ignored
npm run db:migrate:local                          # creates the local D1 database
npm run build && npm run dev:api                  # Worker + built app on http://localhost:8787
API_TOKEN=local-dev-token npm run smoke -- http://localhost:8787 --write
```

For UI work, run `npm run dev` (port 5173) next to `npm run dev:api`; Vite proxies `/api` to the Worker.
API tests (`worker/api.test.ts`) run against an in-memory SQLite that mimics D1, so they need no Cloudflare account.

Sync is verified end to end with two simulated phones (`scripts/e2e-sync.mjs`): connect with a token, log, see it on the second phone, reload offline, keep logging, reconnect.
