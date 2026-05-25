# Listmonk Foundation Flow Templates

Three HTML templates that implement the Foundation flows from the bZ
newsletter playbook. Upload each one to Listmonk (Settings →
**Transactional templates** → New) using the names + IDs below, then
the worker's auto-fire + daily-cron logic will pick them up.

| Template ID env var | Listmonk template name | Fires when |
|---|---|---|
| `LISTMONK_TPL_WELCOME` | `bz-welcome-instant` | within 60s of new subscriber confirmation (auto-fired by `/api/subscribe`) |
| `LISTMONK_TPL_FIRST_MONTH_D3` | `bz-first-month-day-3` | 3 days after signup (daily cron) |
| `LISTMONK_TPL_FIRST_MONTH_D10` | `bz-first-month-day-10` | 10 days after signup (daily cron) |
| `LISTMONK_TPL_FIRST_MONTH_D21` | `bz-first-month-day-21` | 21 days after signup (daily cron) |
| `LISTMONK_TPL_WINBACK` | `bz-winback-90d` | 90 days after last-open (daily cron) |

After upload, set the matching template IDs as worker secrets:

```bash
wrangler secret put LISTMONK_TPL_WELCOME           # numeric Listmonk template id
wrangler secret put LISTMONK_TPL_FIRST_MONTH_D3
wrangler secret put LISTMONK_TPL_FIRST_MONTH_D10
wrangler secret put LISTMONK_TPL_FIRST_MONTH_D21
wrangler secret put LISTMONK_TPL_WINBACK
```

The cron trigger fires daily at 09:00 UTC (see `wrangler.toml`
`[triggers]` block). It queries Listmonk subscribers via `/api/subscribers`
filtered by `created_at`/`last_active_at`, and fires the corresponding
template via `/api/tx`.

All templates use the Listmonk-standard `{{ .Subscriber.Email }}` etc.
template variables. Copy each `.html` file body verbatim into the
template body field in Listmonk.
