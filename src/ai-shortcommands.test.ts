import { describe, expect, it } from 'vitest';
import { buildShortCommandsPalette, listCommands, type SlashRegistry } from './ai-shortcommands';

const REG: SlashRegistry = {
  help: { sig: '', desc: 'show commands', cat: 'Chat' },
  clear: { sig: '', desc: 'wipe chat', cat: 'Chat' },
  play: { sig: '', desc: 'resume playback', cat: 'Playback', hostHandled: true },
  pause: { sig: '', desc: 'pause playback', cat: 'Playback', hostHandled: true },
  viz: { sig: ' <mode>', desc: 'switch visualizer', cat: 'Viz', hostHandled: true },
  mood: { sig: ' <word>', desc: 'suggest tracks for a mood', cat: 'Intel' },
  unknown: { sig: '', desc: 'unknown category', cat: 'Misc' }
};

describe('buildShortCommandsPalette', () => {
  it('produces a command-palette widget with a title containing the count', () => {
    const w = buildShortCommandsPalette(REG);
    expect(w.kind).toBe('command-palette');
    expect(w.title).toContain('7 shortcommands');
    expect(w.hint).toBeTruthy();
  });

  it('orders groups Chat→Intel→Playback→Queue→Viz→Audio→Share then extras alpha', () => {
    const w = buildShortCommandsPalette(REG);
    expect(w.groups.map(g => g.label)).toEqual(['Chat', 'Intel', 'Playback', 'Viz', 'Misc']);
  });

  it('sorts commands within each group alphabetically', () => {
    const w = buildShortCommandsPalette(REG);
    const chat = w.groups.find(g => g.label === 'Chat')!;
    expect(chat.items.map(i => i.cmd)).toEqual(['clear', 'help']);
  });

  it("strips the leading space from sig (so renderer doesn't double-space) and drops empty sigs", () => {
    const w = buildShortCommandsPalette(REG);
    const viz = w.groups.find(g => g.label === 'Viz')!.items[0];
    expect(viz.cmd).toBe('viz');
    expect(viz.sig).toBe('<mode>');
    const help = w.groups.find(g => g.label === 'Chat')!.items.find(i => i.cmd === 'help')!;
    expect(help.sig).toBeUndefined();
  });

  it('every command has a non-empty description', () => {
    const w = buildShortCommandsPalette(REG);
    for (const g of w.groups) {
      for (const it of g.items) {
        expect(it.desc).toBeTruthy();
      }
    }
  });

  it('preserves every command exactly once', () => {
    const w = buildShortCommandsPalette(REG);
    const seen = new Set<string>();
    for (const g of w.groups) {
      for (const it of g.items) {
        expect(seen.has(it.cmd), `duplicate ${it.cmd}`).toBe(false);
        seen.add(it.cmd);
      }
    }
    expect(seen.size).toBe(Object.keys(REG).length);
  });
});

describe('listCommands', () => {
  it('flattens and orders by category-rank then cmd', () => {
    const flat = listCommands(REG);
    expect(flat.map(f => f.cmd)).toEqual(['clear', 'help', 'mood', 'pause', 'play', 'viz', 'unknown']);
  });
});
