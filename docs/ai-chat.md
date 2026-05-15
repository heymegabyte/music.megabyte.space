# AI chat panel

The AI DJ lives in `src/ai-chat.ts` and renders into a single `<aside class="aichat__panel">` element appended to `<body>` from `src/main.ts`. It is a vanilla TypeScript module — no framework, no shadow DOM. The same panel handles the FAB, the conversation list, the composer, slash commands, streaming, voice input, message tools, and the new rich-widget renderer.

## What it does

- **Floating action button** — bottom-right `[data-aichat="fab"]`. Hidden via CSS when the panel is open. Restores focus on close.
- **Side panel** — `[data-aichat="panel"]`. Slides in from the right on desktop, near-fullscreen on phones. `Cmd/Ctrl + I` toggles. `Escape` closes.
- **Sessions** — multi-conversation list persisted to `localStorage` under `bz:aichat:state`. Rename, pin, delete, branch, export to Markdown.
- **Streaming replies** — SSE from `POST /api/ai/chat`. Worker streams Anthropic Claude responses; client renders tokens incrementally with a blinking caret.
- **Slash commands** — `/help`, `/clear`, `/copy`, `/persona <name>`, `/play`, `/pause`, `/viz <mode>`, `/catalog`, `/track <id>`, `/album <id>`, `/shortcommands`, …
- **Rich widgets** — assistant messages can carry a `widgets[]` array of typed payloads (track cards, command palettes, photos, pricing tiers, alerts, citations, …). See [`ai-chat-widgets.md`](./ai-chat-widgets.md).
- **Voice** — Web Speech API push-to-talk. Wake-word listener ("hey bZ") is opt-in via the settings drawer.
- **Search** — `Cmd/Ctrl + F` opens an inline search bar that highlights matching messages in the current session.

## Enabling the AI backend

The Worker reads `ANTHROPIC_API_KEY` from Wrangler secrets:

```bash
npx wrangler secret put ANTHROPIC_API_KEY --env production
```

When the secret is missing, `POST /api/ai/chat` responds `503 {"error":"ai_not_configured"}` and the client surfaces a friendly inline notice. The panel still works as a local UI: slash commands that don't need the model (`/help`, `/clear`, `/catalog`, `/track`, `/album`, `/shortcommands`, …) all run client-side.

## Privacy

- Conversations live in `localStorage` only. Nothing is uploaded unless the user posts a message.
- The Worker does not log message bodies; it forwards them to Anthropic and streams the response back. Add request-level logging only when explicitly debugging.
- The voice transcription runs in the user's browser via Web Speech API — audio never leaves the device.
- `/clear` wipes the active session immediately; `/forget` wipes every session and reloads the panel.

## Security

- Every widget URL goes through `safeUrl()` (`src/ai-widgets.ts`). `javascript:`, `data:`, `file:`, `blob:`, and protocol-relative `//evil.com` URLs are rewritten to `#`.
- Every widget string runs through `escapeHtml()` before injection. The widget renderer is a pure HTML-string builder; it never touches `innerHTML` with raw input.
- Click delegation in `messages.addEventListener('click', …)` routes `[data-aichat-cmd]` buttons through `handleSlash('/'+cmd)` so palette clicks reuse the same audit path as typed commands.
- Destructive commands (`/clear`, `/forget`, `/reset`) confirm via `setStatus()` before mutating local state.

## Adding a new feature

1. Decide whether it belongs in the worker (network call, secrets, persistence) or the client (UI, local state).
2. For a new slash command see [`ai-chat-commands.md`](./ai-chat-commands.md).
3. For a new rich response shape see [`ai-chat-widgets.md`](./ai-chat-widgets.md).
4. Update `tests/journey.spec.ts` — every new user-visible affordance gets at least one Playwright assertion against the production-served bundle.
5. Run `npm run build && npx vitest run && npx tsc --noEmit && npx prettier --write src/ai-chat.ts src/ai-widgets.ts src/ai-shortcommands.ts` before opening a PR.
