# Maintenance

Operational runbook for `music.megabyte.space`. Routine work, KV inspection, secret rotation, and what to do when something is on fire.

## Routine

| Cadence     | Task                                              | How                                                                                                                      |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Per release | Smoke the live site at 6 breakpoints              | `PROD_URL=https://music.megabyte.space npm run test:e2e`                                                                 |
| Per release | Confirm the worker picked up the new bundle       | `curl -sI https://music.megabyte.space \| grep -i 'cf-ray\|x-edge'` then watch the version tail with `npx wrangler tail` |
| Weekly      | Eyeball KV usage                                  | `npx wrangler kv:key list --binding COUNTERS --remote \| wc -l`                                                          |
| Monthly     | `npm outdated` and apply low-risk patch bumps     | One PR per group (lint+format / build tools / test tools). Major bumps get their own PR with a rollback note.            |
| Quarterly   | Rotate `PUSH_ADMIN_TOKEN` and `ANTHROPIC_API_KEY` | See [Secret rotation](#secret-rotation).                                                                                 |
| As needed   | Refresh OG cards after copy/tag changes           | `npm run og:gen` then `wrangler deploy`.                                                                                 |

## KV inspection

The `COUNTERS` namespace holds everything the worker remembers between requests: play counts, share counts, rate-limit windows, push subscriptions, and the auto-discovered Listmonk list id.

```bash
# List all keys (paginates 1000 at a time).
npx wrangler kv:key list --binding COUNTERS --remote | jq '.[].name'

# Read a specific counter.
npx wrangler kv:key get "play:birch-swing-heaven" --binding COUNTERS --remote

# Inspect a push subscription record.
npx wrangler kv:key get "push:sub:<endpoint-hash>" --binding COUNTERS --remote | jq

# Bulk-export for a backup before risky migrations.
npx wrangler kv:key list --binding COUNTERS --remote > kv-keys.json
```

Key prefixes used by the worker:

| Prefix               | Purpose                                                           | TTL                      |
| -------------------- | ----------------------------------------------------------------- | ------------------------ |
| `play:<trackId>`     | Lifetime play count (monotonic).                                  | none                     |
| `share:<trackId>`    | Share-button click count.                                         | none                     |
| `rate:<ip>:<bucket>` | Per-IP rate-limit window for `/api/subscribe` and `/api/ai/chat`. | 60s                      |
| `push:sub:<hash>`    | One row per active push subscription.                             | none, pruned on 404/410. |
| `listmonk:list:id`   | Cached list id resolved on first `/api/subscribe`.                | 1h                       |

## Secret rotation

Order matters — rotate the dependent service first, then update Wrangler, then deploy.

### `ANTHROPIC_API_KEY`

1. Mint a new key at <https://console.anthropic.com/settings/keys>.
2. `npx wrangler secret put ANTHROPIC_API_KEY` and paste the new value.
3. `npx wrangler deploy` (no code change — Wrangler picks up the secret on next deploy).
4. Hit `/api/ai/chat` from the AI drawer and verify a streamed reply.
5. Revoke the old key in the Anthropic console.

### `PUSH_ADMIN_TOKEN`

1. Generate a high-entropy string: `openssl rand -base64 32`.
2. `npx wrangler secret put PUSH_ADMIN_TOKEN`.
3. `npx wrangler deploy`.
4. Update any local `.dev.vars` plus the `drop:broadcast` workflow secret (GitHub Actions repository secret).
5. Test with a dry-run drop: `PUSH_ADMIN_TOKEN=… npm run drop:broadcast -- --dry-run`.

### VAPID keypair

VAPID rotation invalidates every existing browser subscription — they will silently stop receiving pushes until they re-subscribe. Only rotate if a key leaks.

1. `node scripts/gen-vapid.mjs` prints a new keypair.
2. `npx wrangler secret put VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT`.
3. `npx wrangler deploy`.
4. Existing subscriptions in `push:sub:*` are now orphaned — purge them in a follow-up: list keys with `kv:key list` and delete the stale ones, or accept that the next `/api/push/send` will 410-prune them naturally.

## Cache purge

`MetaRewriter` rewrites `<head>` at the edge. After a deploy, the previous HTML may still be cached at Cloudflare's edge. Purge the zone so visitors see the new metadata immediately.

```bash
ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_KEY" \
  "https://api.cloudflare.com/client/v4/zones?name=megabyte.space" | jq -r '.result[0].id')

curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

## Incident response

### Symptom: `/api/ai/chat` returning 503 `ai_not_configured`

`ANTHROPIC_API_KEY` is unset or empty. Check `npx wrangler secret list`. If present, the secret may be set in the wrong environment — confirm `wrangler deploy` was run against production, not a preview.

### Symptom: push sends silently dropping

Pull the latest 200 push keys and check for `404`/`410` from the push gateway:

```bash
npx wrangler tail --format=pretty | grep -E 'push|VAPID'
```

If every send is 410, VAPID was rotated without re-subscribing clients. If just some, the worker is auto-pruning expired endpoints — that's healthy.

### Symptom: HTML showing `&amp;amp;` in titles

Regression of the HTMLRewriter double-encoding fix. `MetaRewriter` calls `setInnerContent(title)` without `{ html: true }` — pre-escaping the value will stack. See `worker/escape.ts` and `worker/index.ts` near `MetaRewriter`.

### Symptom: track page `<title>` matches the homepage `<title>`

`MetaRewriter` did not run, or the SEO entry is missing for that route. Confirm the route is listed in `wrangler.toml` `run_worker_first` and that `src/track-meta.ts` has an entry keyed by the path. The Playwright `per-route meta unique` test guards against the first case.

### Symptom: build fails on CI but passes locally

CI runs `tsc -b` + `vite build` against the bundled `package-lock.json`. Most divergences are stale local `node_modules` — `rm -rf node_modules && npm ci` to reproduce.

## Rollback

There is no separate staging environment. To roll back a bad deploy:

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id-of-previous-good-deploy>
```

KV writes from the bad deploy are not rolled back. If the bad deploy corrupted counter values, restore from the last `kv:key list > kv-keys.json` backup and replay missing increments manually — there is no time-travel for Workers KV.

## Dependency hygiene

- Vite 6 + tsc 5 are the load-bearing build chain. Pin majors; bump minors after a green `npm test && npm run build`.
- Playwright is the only heavyweight dev dep. Keep `@playwright/test` and the matching `playwright-chromium` browser version aligned — mismatches surface as "executable doesn't exist" errors.
- The runtime bundle imports only `@cloudflare/workers-types` (devDep) and pulls in no third-party JS at runtime. Audit `package.json` quarterly to keep it that way.

## What to log when escalating

If a problem needs another set of eyes, capture:

1. The output of `npx wrangler tail --format=json --limit 100` covering the affected window.
2. The deploy id under suspicion: `npx wrangler deployments list | head -5`.
3. The browser-side console log if the report includes a user-visible regression.
4. A relevant `curl -sI https://music.megabyte.space/<route>` so the response headers are captured.
