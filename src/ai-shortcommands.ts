/**
 * `/shortcommands` palette builder.
 *
 * Consumes the SLASH registry shape used by `src/ai-chat.ts` and produces a
 * `command-palette` widget grouped by category. Pure module — no DOM access,
 * no `document`/`window`/`navigator` references — so it loads under Vitest and
 * can be unit-tested directly.
 */

import type { CommandPaletteWidget } from './ai-widgets';

export interface SlashDescriptor {
  sig: string;
  desc: string;
  cat: string;
  hostHandled?: boolean;
}

export type SlashRegistry = Record<string, SlashDescriptor>;

const CATEGORY_ORDER = ['Chat', 'Intel', 'Playback', 'Queue', 'Viz', 'Audio', 'Share'] as const;

/**
 * Build the `command-palette` widget shape from a SLASH registry. The result
 * is ready to feed `renderWidget`. Groups follow a stable order (the canonical
 * `CATEGORY_ORDER`) with any unknown categories appended alphabetically so the
 * palette stays predictable across builds.
 */
export function buildShortCommandsPalette(slash: SlashRegistry): CommandPaletteWidget {
  const groups = groupByCategory(slash);
  return {
    kind: 'command-palette',
    title: `${Object.keys(slash).length} shortcommands`,
    hint: 'Tap any command to run it. Type `/` in the composer to filter.',
    groups
  };
}

function groupByCategory(slash: SlashRegistry): CommandPaletteWidget['groups'] {
  const buckets = new Map<string, CommandPaletteWidget['groups'][number]['items']>();
  for (const [cmd, def] of Object.entries(slash)) {
    const cat = def.cat || 'Chat';
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push({ cmd, sig: def.sig?.trim() || undefined, desc: def.desc });
  }
  for (const items of buckets.values()) {
    items.sort((a, b) => a.cmd.localeCompare(b.cmd));
  }
  const known = CATEGORY_ORDER.filter(c => buckets.has(c));
  const extras = [...buckets.keys()].filter(c => !CATEGORY_ORDER.includes(c as never)).sort();
  return [...known, ...extras].map(label => ({ label, items: buckets.get(label)! }));
}

/**
 * Resolve a registry into a flat list, ordered by category then command. Useful
 * for `/help` markdown rendering when a widget palette isn't appropriate.
 */
export function listCommands(
  slash: SlashRegistry
): { cmd: string; sig: string; desc: string; cat: string }[] {
  const flat = Object.entries(slash).map(([cmd, def]) => ({
    cmd,
    sig: def.sig || '',
    desc: def.desc,
    cat: def.cat || 'Chat'
  }));
  const catRank = (c: string) => {
    const idx = CATEGORY_ORDER.indexOf(c as never);
    return idx === -1 ? CATEGORY_ORDER.length : idx;
  };
  flat.sort((a, b) => {
    const dr = catRank(a.cat) - catRank(b.cat);
    if (dr !== 0) return dr;
    return a.cmd.localeCompare(b.cmd);
  });
  return flat;
}
