#!/usr/bin/env node
// Ensure each lyric line in src/data.ts starts with a capital letter.
// Defaults to a deterministic local pass (no API). Pass --ai to use Anthropic
// for proper-noun-aware capitalization (preserves "iPhone", "iCloud" etc.).
//
//   node scripts/capitalize-lyrics.mjs            # local, idempotent
//   node scripts/capitalize-lyrics.mjs --ai       # Anthropic-assisted
//   node scripts/capitalize-lyrics.mjs --dry      # print diff, don't write
//
// Reads/writes src/data.ts in place. Diff-clean when nothing changes.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/data.ts');

const flags = new Set(process.argv.slice(2));
const useAI = flags.has('--ai');
const dryRun = flags.has('--dry');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/** Local capitalize: first non-whitespace alpha char → uppercase. Preserves
 *  intra-word casing (proper nouns, brand names, mid-line "I"/"AI"). */
function localCapitalize(line) {
  const m = line.match(/^(\s*['"`""'']*\s*)(.)(.*)$/s);
  if (!m) return line;
  const [, lead, ch, rest] = m;
  if (!/[a-z]/.test(ch)) return line;
  return `${lead}${ch.toUpperCase()}${rest}`;
}

async function aiCapitalize(lines) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY required for --ai mode');
  const prompt = [
    'For each numbered lyric line below, return the SAME line but ensure the first',
    'meaningful letter is capitalized. Preserve every other character (punctuation,',
    'apostrophes, intra-word casing, brand names like iPhone/AI/JC, proper nouns).',
    'Do not paraphrase. Do not add words. Output one corrected line per input line,',
    'numbered identically, no extra commentary.',
    '',
    ...lines.map((l, i) => `${i + 1}. ${l}`)
  ].join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const text = json?.content?.[0]?.text ?? '';
  const out = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*\d+\.\s+(.*)$/);
    if (m) out.push(m[1]);
  }
  if (out.length !== lines.length) {
    throw new Error(`AI returned ${out.length} lines for ${lines.length} inputs`);
  }
  return out;
}

async function main() {
  const src = await readFile(DATA_PATH, 'utf8');
  // Match each lyrics: [...] block. Lines are single-quoted strings inside.
  const blockRe = /(lyrics:\s*\[)([\s\S]*?)(\n\s{4}\])/g;
  const lineRe = /^(\s*)'((?:[^'\\]|\\.)*)'(,?\s*)$/;

  const allLines = [];
  const blocks = [];
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const [whole, head, body, tail] = m;
    const innerLines = body.split('\n');
    const tracked = innerLines.map(line => {
      const lm = line.match(lineRe);
      if (!lm) return { line, mutable: false };
      const [, indent, content, comma] = lm;
      const idx = allLines.push(content) - 1;
      return { line, mutable: true, indent, comma, idx };
    });
    blocks.push({ start: m.index, end: m.index + whole.length, head, tail, tracked });
  }

  if (!allLines.length) {
    console.error('No lyrics blocks found in src/data.ts — nothing to do.');
    process.exit(1);
  }

  // Convert source-form escapes to plain text for transformation, then re-escape.
  const unescape = s => s.replace(/\\(.)/g, '$1');
  const reescape = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const plainLines = allLines.map(unescape);

  let plainCorrected;
  if (useAI) {
    process.stderr.write(`Capitalizing ${plainLines.length} lines via ${MODEL}…\n`);
    plainCorrected = await aiCapitalize(plainLines);
  } else {
    plainCorrected = plainLines.map(localCapitalize);
  }

  let changed = 0;
  let out = '';
  let cursor = 0;
  for (const b of blocks) {
    out += src.slice(cursor, b.start);
    out += b.head;
    for (const t of b.tracked) {
      if (!t.mutable) {
        out += '\n' + t.line;
        continue;
      }
      const newPlain = plainCorrected[t.idx];
      const newLine = `${t.indent}'${reescape(newPlain)}'${t.comma}`;
      if (newLine !== t.line) changed++;
      out += '\n' + newLine;
    }
    // Trailing block markers were captured as the literal `tail` string;
    // include it verbatim to preserve the closing bracket and indentation.
    out += b.tail;
    cursor = b.end;
  }
  out += src.slice(cursor);

  if (changed === 0) {
    console.log('All lyric lines already start with a capital letter. No changes.');
    return;
  }
  if (dryRun) {
    console.log(`[dry] would update ${changed} line(s) in src/data.ts`);
    let shown = 0;
    for (let i = 0; i < plainLines.length && shown < 10; i++) {
      if (plainLines[i] !== plainCorrected[i]) {
        console.log(`  - ${plainLines[i]}`);
        console.log(`  + ${plainCorrected[i]}`);
        shown++;
      }
    }
    return;
  }
  await writeFile(DATA_PATH, out, 'utf8');
  console.log(`Updated ${changed} line(s) in src/data.ts`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
