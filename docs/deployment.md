# Deployment

`music.megabyte.space` is one Cloudflare Worker fronting a static asset bundle. Deploying is two steps: ship the worker, then purge the zone so the HTMLRewriter rewrites land instantly.

## Prerequisites

- `wrangler` 4.x (`npx wrangler` works without a global install).
- Wrangler logged into the Cloudflare account that owns `music.megabyte.space`. One-time: `npx wrangler login`.
- A green `npm run build` locally. Wrangler runs the build internally, but verify first so you don't deploy a broken bundle.

## Ship a release

```bash
npm run build           # tsc -b && vite build → dist/
npx wrangler deploy     # uploads worker/index.ts + dist/ as ASSETS
```

`wrangler.toml` binds:

- `ASSETS` — the static `dist/` bundle (HTML, CSS, JS, audio, images, lyrics).
- `COUNTERS` — KV namespace for plays, shares, rate-limit tokens, push subs, listmonk cache.

## Purge cache

The HTMLRewriter mutates `<head>` per route, so cached HTML at the edge will keep serving the previous metadata until purged.

```bash
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}' \
  https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache
```

Run this immediately after `wrangler deploy`. The dev experience is: deploy → purge → reload. If you skip the purge, you'll spend ten minutes thinking the worker didn't apply.

## Secrets

The worker reads these via `env.<NAME>`. Set them with `wrangler secret put <NAME>`:

| Secret               | Used by          | Required                                            |
| -------------------- | ---------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | `/api/ai/chat`   | Yes (or AI chat 503s)                               |
| `LISTMONK_API_TOKEN` | `/api/subscribe` | Yes (or subscribe 503s)                             |
| `LISTMONK_API_URL`   | `/api/subscribe` | Yes                                                 |
| `LISTMONK_LIST_UUID` | `/api/subscribe` | Optional — auto-discovered + cached in KV otherwise |
| `VAPID_PUBLIC_KEY`   | `/api/push/*`    | Required for push                                   |
| `VAPID_PRIVATE_JWK`  | `/api/push/send` | Required for push send                              |
| `VAPID_SUBJECT`      | `/api/push/send` | Required (`mailto:` or `https:`)                    |
| `PUSH_ADMIN_TOKEN`   | `/api/push/send` | Required — admin Bearer gate                        |

Verify what's set:

```bash
npx wrangler secret list
```

Never echo a secret. Never commit `.dev.vars`. Local Wrangler reads `.dev.vars` automatically; that file is gitignored.

## Rolling back

Wrangler keeps the last 10 deployments. Roll back with:

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Then purge the zone again. KV state is not part of the deployment, so a rollback does not affect plays/shares/push subs.

## Verifying a deploy

After purge, hit four things:

1. `https://music.megabyte.space/` — homepage 200, console clean, audio bootable.
2. `https://music.megabyte.space/<track-id>` — per-route `<title>` matches `src/track-meta.ts`.
3. `https://music.megabyte.space/api/oembed?url=https://music.megabyte.space/<track-id>` — JSON 200.
4. `npm run test:e2e` against `PROD_URL=https://music.megabyte.space`.

If the per-route title is stale, the purge didn't land — re-run it.

## Custom Cast receiver

The cast receiver at `cast-receiver/` is bundled and served from the same worker (path: `/cast-receiver/`). Re-publishing the receiver requires a separate trip through the Google Cast Console (App ID `228565CB`). Until the new receiver is device-bound, leave `RECEIVER_FALLBACK = 'CC1AD845'` in `src/cast-protocol.ts` — the Default Media Receiver — as the engaged App ID. See `feedback_cast_default_receiver_first.md` in memory for the gotcha.

## Operational tips

- KV writes are eventually consistent. A play count might lag a few seconds.
- The audio edge cache absorbs 503s from the assets origin with exponential backoff (75 → 225 → 675 ms). If a track is genuinely missing, the worker returns 503 with `Retry-After: 5`.
- AI chat is rate-limited per IP at 6 seconds. Tab-spammers see 429, not a leaked Anthropic bill.
