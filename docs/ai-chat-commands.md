# AI chat commands

Every `/`-prefixed string the user types is parsed by `handleSlash()` in `src/ai-chat.ts`. The registry — `const SLASH = { … }` around line 1224 — is the single source of truth. Commands are either:

- **Local** — `def.run(args)` runs in the panel. Examples: `/help`, `/clear`, `/catalog`, `/track`, `/album`, `/shortcommands`.
- **Host-handled** — `def.hostHandled = true`. `handleSlash` calls `opts.onCommand(lc, args)` which `src/main.ts` wires to the audio engine. Examples: `/play`, `/pause`, `/seek`, `/viz <mode>`, `/cast`, `/loop`.

Run `/shortcommands` (or its alias `/sc`) inside the panel to render every command as a clickable, grouped palette widget.

## Category convention

| Category   | What lives there                                                 |
| ---------- | ---------------------------------------------------------------- |
| `Chat`     | Conversation hygiene: `/help`, `/clear`, `/new`, `/export`, …    |
| `Intel`    | Catalog and analysis: `/catalog`, `/track`, `/album`, `/mood`, … |
| `Playback` | Engine control: `/play`, `/pause`, `/seek`, `/speed`, …          |
| `Queue`    | Queue + shuffle + repeat                                         |
| `Viz`      | Visualizer mode + palette + trails                               |
| `Audio`    | EQ + reverb + instrumental gate                                  |
| `Share`    | Casting + AirPlay + clip + snap                                  |

`buildShortCommandsPalette` (in `src/ai-shortcommands.ts`) groups by category in this order, then sorts alphabetically inside each group. Unknown categories sort alphabetically at the end.

## Built-in commands worth knowing

| Command                 | Effect                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `/help`                 | Markdown command reference inline                            |
| `/shortcommands`, `/sc` | Renders the grouped command palette widget                   |
| `/clear`                | Wipes the active session (after status confirmation)         |
| `/new`                  | Starts a fresh session                                       |
| `/export`               | Downloads the active session as Markdown                     |
| `/persona <name>`       | Switches the assistant voice (`/persona` lists choices)      |
| `/catalog`              | Lists every track grouped by album                           |
| `/track <id>`           | Renders a `track-card` widget for that track                 |
| `/album <id>`           | Renders an `album-card` widget for that album                |
| `/play`, `/pause`, …    | Forwarded to the audio engine via `opts.onCommand`           |
| `/viz <mode>`           | Switches the visualizer (`/viz` lists modes)                 |
| `/seek <m:ss>`          | Jumps the playhead                                           |
| `/speed <0.5-2>`        | Sets playback rate                                           |
| `/cast`                 | Opens the Chromecast picker                                  |

## Adding a new command

1. Pick a category. Add it to `CATEGORY_ORDER` in `src/ai-shortcommands.ts` if it's new.
2. Append an entry to `SLASH` in `src/ai-chat.ts`:
   ```ts
   yourcommand: {
     sig: ' <arg>',            // shown after `/yourcommand` in /help — keep terse
     desc: 'one-line summary', // 4-7 words is best
     cat: 'Intel',             // canonical category
     run: args => { /* … */; return true; },
     // hostHandled: true,     // only if main.ts will route it to the engine
   },
   ```
3. If local, implement the body inline or factor out a `function showXyz(args) { … }` helper next to `showShortCommands`. Use `pushAssistant(content)` for plain text or `pushAssistantWithWidgets(content, [widget])` for rich payloads.
4. If host-handled, set `hostHandled: true` with `run: () => false` and add the new switch case in `main.ts`'s `onCommand` wiring.
5. Run the registry's existing test guarantees: every command has a non-empty `desc`, no duplicates, and renders inside the palette. `src/ai-shortcommands.test.ts` already covers these — adding a command updates the count assertions only.
6. Update [`ai-chat-commands.md`](./ai-chat-commands.md) when the command is user-facing and worth promoting.

## Command palette UX

- Buttons render with `data-aichat-cmd="<cmd>"`. The click handler in `src/ai-chat.ts` (the `messages.addEventListener('click', …)` block) intercepts every `[data-aichat-cmd]` and routes it through `handleSlash('/' + cmd)`. That guarantees palette clicks and typed commands share the same audit path.
- The palette is keyboard-friendly: the underlying `<button>` elements are tab-focusable, focus rings come from the `.aichat__widget--palette .aichat__w-cmd:focus-visible` rule in `src/style.css`.
- The palette respects `prefers-reduced-motion` (no transform animation) and collapses to a single column under 540 px.
