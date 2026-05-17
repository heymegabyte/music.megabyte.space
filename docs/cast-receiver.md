# Cast receiver

Custom Chromecast receiver for `music.megabyte.space`. Renders the full 10-foot UI — palette-driven background, real-FFT visualizer, scroll-synced lyrics, navigable queue sidebar — instead of Google's stock Default Media Receiver.

- App ID: `228565CB`
- Sender origin: `https://music.megabyte.space`
- Custom namespace: `urn:x-cast:com.megabyte.music`
- Source: `cast-receiver/index.html` + `cast-receiver/receiver.ts` + `cast-receiver/receiver.css`
- Protocol: `src/cast-protocol.ts`

The sender (`src/cast.ts`) defaults to App ID `228565CB`. If the picked device isn't registered to that App ID, the SDK returns `select_unknown_id` (905) on session start and the sender transparently retries with `CC1AD845` (Default Media Receiver) so unbound TVs still play audio with Google's stock UI. Custom-receiver-only features (lyrics push, queue sidebar, palette sync, real visualizer) are skipped silently in fallback mode.

## Local preview — test it without a Chromecast

The receiver detects "no `CrKey/` in UA" and swaps the CAF `playerManager` for a thin `HTMLAudioElement` shim so the page renders + plays in any browser tab.

```bash
npm run cast:preview
# Opens http://localhost:5173/cast-receiver/?demo=1 — auto-seeds the full catalog.
```

URL parameters:

| param | effect |
| --- | --- |
| `?demo=1` | seed every track in `src/data.ts` as the queue, start at index 0 |
| `?track=<id>` | start the demo at a specific track, e.g. `?track=birch-swing-heaven` |
| `?autoplay=0` | boot paused so click-to-play / browser-autoplay-policy is testable |

Once the page is open, `window.__castReceiver` exposes a programmatic API for Playwright + devtools — the same surface tests use:

```ts
window.__castReceiver.loadQueue([{ id, title, artist, album, cover, audio }], 0);
window.__castReceiver.play();
window.__castReceiver.seek(30);
window.__castReceiver.state();   // { playing, position, duration, trackId }
window.__castReceiver.current(); // currently-playing item
window.__castReceiver.runtime;   // mutable state — read-only in tests
```

## Testing doctrine

Cast surfaces are tested in the same shape they ship in.

1. **No mocks for the receiver.** Tests load `/cast-receiver/?demo=1` against the production-shaped bundle and drive it through `window.__castReceiver`. The DOM, CSS, view transitions, visualizer canvas, and lyrics renderer are all the real ones.
2. **No mocks for the audio engine.** The standalone shim wraps a real `HTMLAudioElement` against the real R2-served MP3 — load events, time updates, errors, and ended events all fire from the actual media pipeline.
3. **Visualizer wiring is asserted.** The Web Audio analyser is built lazily on the audio element; tests can assert the analyser exists (`window.__castReceiver.audio` is the source node consumer) and that the canvas isn't blank during playback.
4. **D-pad parity.** Keyboard tests press `ArrowUp`/`ArrowDown` to scroll the queue, `Enter` to play/pause, and `ArrowLeft`/`ArrowRight` to seek — exactly what a TV remote dispatches.
5. **CAF-only paths get a thin contract test, not a stub.** Anything that only runs under `CrKey/` (e.g. `setMessageInterceptor` for LOAD requests, `ctx.start()` playback config) is asserted at the boundary via a unit test that calls the interceptor with a recorded payload — never a full mock of the SDK.

This matches the broader rule: *all testing should be done in a manner as similar to the final experience as possible.*

## Visualizer architecture

`cast-receiver/receiver.ts` runs a single rAF loop that paints two layers on `#viz`:

1. **Ambient palette blobs.** Three radial gradients (`--accent`, `--vibrant`, `--muted`) drift slowly via a low-frequency phase counter. Always drawn — even when paused — so the idle / lyrics views never look dead.
2. **Real-FFT bars.** A lazy `AudioContext` + `AnalyserNode` is built on the current media element (`standaloneAudio` in preview, `playerManager.getMediaElement()` in CAF) the first frame after playback starts. `fftSize: 256`, `smoothingTimeConstant: 0.78`. The 128 frequency bins are averaged down to 64 bars and rendered with an `--accent → --vibrant` linear gradient. If `getMediaElement()` returns null or the source can't be tapped (cross-origin without CORS), the bars fall back to a deterministic sine waveform so the layout never collapses.

Palette overrides arrive via the `palette:set` custom message from the sender (`src/main.ts` calls `cast.setPalette(...)` whenever an album is selected). The receiver maps the payload into CSS custom properties (`--accent`, `--vibrant`, `--muted`, `--bg`, `--ink`) on `:root`, so both the background gradient and the visualizer pick up the new colours on the next paint.

## Adding a new sender message

1. Add the new payload type to `src/cast-protocol.ts` + the `CastMsg` discriminant.
2. Sender side: call `cast.sendCustom('your:type', payload)` from `src/main.ts`. The custom channel is opened automatically when a custom-receiver session starts.
3. Receiver side: extend `switch (msg.type)` in `dispatch()` (`cast-receiver/receiver.ts`). Wrap the handler in try/catch + `logErr` so a malformed payload can't wedge the runtime.
4. Bump `PROTOCOL_VERSION` in `cast-protocol.ts` if the change is breaking. The receiver logs a warn when sender + receiver versions don't match.
5. Add a test in `tests/cast.spec.ts` that loads `/cast-receiver/?demo=1`, dispatches the new message via the `window.__castReceiver` shim, and asserts the resulting DOM/state.
