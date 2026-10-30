# Deploying to Cloudflare

One command, safe to re-run:

```sh
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/deploy.mjs
```

It creates the D1 database if missing, applies migrations, builds the app, deploys the Worker (app and API share one address), sets the access token once, and runs the read-only smoke test against the live address.

## What you need
1. **Account ID**: Cloudflare dashboard → Workers & Pages → right-hand side, "Account ID".
2. **API token** (dashboard → My Profile → API Tokens → Create Token): start from the **"Edit Cloudflare Workers"** template and add **Account → D1 → Edit**. Scope it to your account only.
3. A **workers.dev subdomain**. If your account has none yet, the first deploy tells you; create one in the dashboard under Workers & Pages.

## In a Claude Code cloud session
Environment settings (cloud environment menu → Edit):
- **Secrets / environment variables:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. A new session picks them up.
- **Network access:** allow `api.cloudflare.com` and `*.workers.dev` (the second one is only needed for the post-deploy check).

## After the first deploy
1. Commit the `database_id` change that the script made to `wrangler.toml`.
2. On the iPhone, open the printed address in Safari, Share → Add to Home Screen.
3. Settings → Sync → paste the access token → Connect.
4. Export your preview data first (Settings → Export → Copy) if you logged anything in the preview link, then Import it in the real app.

## Later
- Rotate the access token: `node scripts/deploy.mjs --rotate-token`, then paste the new one on each phone.
- Redeploy after a change: the same command. Existing data and the token are left alone.
- Restore points: D1 Time Travel (`npx wrangler d1 time-travel info lift-log`).
