# AI chat widgets

The chat panel can render structured payloads alongside markdown text. Widgets live in `src/ai-widgets.ts` as a discriminated union (`AiChatWidget`) plus a renderer (`renderWidget`, `renderWidgets`). Tests in `src/ai-widgets.test.ts` exercise every kind and every safety branch.

## Contract

```ts
export interface AiChatResponse {
  id: string;
  conversationId: string;
  role: 'assistant';
  text: string; // markdown
  widgets?: AiChatWidget[]; // capped at 24 by renderer
  suggestions?: string[];
  commands?: string[];
  sources?: { label: string; href: string }[];
  metadata?: { model?; latencyMs?; requestId?; confidence? };
}
```

A client message is `ChatMessage`. The renderer in `ai-chat.ts` appends `renderWidgets(m.widgets)` after the markdown body for assistant rows only.

## Kinds

| `kind`            | Use it for                                            | Required fields                                        |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `text-card`       | Short prose block with optional title                 | `body`                                                 |
| `cta`             | One or two action buttons under a headline            | `title`, `primary{label,href}`                         |
| `link-card`       | Single tile linking to an internal or external page   | `title`, `href`                                        |
| `photo`           | Inline image with caption + credit                    | `src`, `alt`                                           |
| `gallery`         | Grid of up to 12 thumbnails                           | `items[].src`, `items[].alt`                           |
| `track-card`      | Highlight one track from `src/data.ts`                | `trackId`, `title`, `album`, `href`                    |
| `album-card`      | Highlight one album                                   | `albumId`, `name`, `trackCount`, `href`                |
| `pricing-card`    | Tier headline + bullet features + optional CTA        | `tier`, `price`, `features[]`                          |
| `faq-accordion`   | `<details>`-driven Q/A list                           | `items[].q`, `items[].a`                               |
| `mini-table`      | Tabular comparison (cell count clamped to header len) | `headers[]`, `rows[][]`                                |
| `stat-card`       | One headline metric with delta + hint                 | `label`, `value`                                       |
| `timeline`        | Ordered list of dated events                          | `items[].when`, `items[].title`                        |
| `command-palette` | Grouped, clickable `/`-commands                       | `groups[].label`, `groups[].items[].cmd`, `items[].desc` |
| `related-pages`   | Navigation list to sibling routes                     | `items[].label`, `items[].href`                        |
| `citation`        | Numbered source list with optional pull-quotes        | `sources[].label`, `sources[].href`                    |
| `status-badge`    | Single inline tone-coded pill                         | `label`, `tone`                                        |
| `alert`           | Banner with `role=alert`/`role=status` based on tone  | `title`, `tone`                                        |
| `code-snippet`    | Highlighted code with copy button                     | `code`                                                 |
| `audio-card`      | Mini player teaser linking into the catalog           | `trackId`, `title`, `href`                             |

## Example payload

```jsonc
{
  "kind": "track-card",
  "trackId": "birch-swing-heaven",
  "title": "Birch Swing Heaven",
  "album": "Canopy Dispatch",
  "vibe": "gospel hustle",
  "cover": "/art/cover-canopy-dispatch.png",
  "href": "/canopy-dispatch/birch-swing-heaven"
}
```

## Safety guarantees

- Every renderer is a pure string builder. No `innerHTML` with untrusted input.
- Every URL is filtered through `safeUrl()`: only `http(s)://`, `mailto:`, `tel:`, and site-relative paths survive. `javascript:`, `data:`, `file:`, `blob:`, and protocol-relative `//host` URLs become `#`.
- Every text field is HTML-escaped via `escapeHtml()`.
- The bundle is capped: at most 24 widgets per assistant message, at most 12 gallery items per widget.
- Unknown `kind` falls through to a friendly text card explaining the issue — never throws.

## Adding a new widget kind

1. Add the new interface to `src/ai-widgets.ts` and extend the `AiChatWidget` union.
2. Implement a `renderXyz(w: XyzWidget): string` function. Use `escapeHtml` + `safeUrl` for every dynamic value.
3. Add the new case to the `switch (w.kind)` in `renderWidget`.
4. Add CSS under the existing `/* Widgets */` block in `src/style.css`, using the `.aichat__widget--<kind>` modifier.
5. Add at least three vitest cases to `src/ai-widgets.test.ts`: happy path, hostile input is escaped, and any field-specific edge case.
6. If a slash command should produce it, add the command per [`ai-chat-commands.md`](./ai-chat-commands.md).

## Server emission (future)

The worker can emit widgets by appending a fenced block to the streamed text:

````md
Here are tonight's recommendations.

```aiwidgets
[
  {
    "kind": "track-card",
    "trackId": "birch-swing-heaven",
    "title": "Birch Swing Heaven",
    "album": "Canopy Dispatch",
    "href": "/canopy-dispatch/birch-swing-heaven"
  }
]
```
````

The client parses the block, validates each entry against the discriminator, and routes through the same renderer. The current build emits widgets only from local slash handlers; server emission is documented for forward compatibility but not yet enabled.
