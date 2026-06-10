#!/usr/bin/env node
/**
 * Curator outreach sender — uses Resend to send the press-release URL
 * to a vetted list of Christian-hip-hop + indie curators. Each address
 * MUST be confirmed by Brian before being added below.
 *
 * Usage:
 *   node scripts/send-curator-outreach.mjs --dry         # print, don't send
 *   node scripts/send-curator-outreach.mjs --to=brian@megabyte.space   # smoke test
 *   node scripts/send-curator-outreach.mjs --all          # send to every CURATORS entry
 */

import { execSync } from 'node:child_process';
const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const sendAll = args.has('--all');
const toArg = [...args].find(a => a.startsWith('--to='))?.slice(5);

const RESEND = execSync('/Users/Apple/.local/bin/get-secret RESEND_API_KEY', { encoding: 'utf8' }).trim();
const FROM = 'bZ <brian@megabyte.space>';

// Vetted curators only. Add new entries after confirming the address.
const CURATORS = [
  // { name: 'Chad Horton',        org: 'Rapzilla',          email: 'chadh@rapzilla.com' },
  // { name: 'Ruslan KD',          org: 'Trackstarz',        email: 'ruslan@trackstarz.com' },
];

const TRACK_ID = 'bootleg-from-tomorrow';
const TRACK_TITLE = 'Bootleg From Tomorrow';
const PRESS_URL = `https://music.megabyte.space/press/${TRACK_ID}`;
const CLIP_URL = `https://music.megabyte.space/clip/${TRACK_ID}`;

function bodyFor({ name, org }) {
  return `Hi ${name || 'there'},

bZ — Newark-based hustle-gospel artist. "${TRACK_TITLE}" is the title cut of a brand-new 8-track release. Cinematic gospel-trap, drill, soul-blues, Latin gospel, and folk-pop across the run. Verified Christian-rap canon — Reach / Humble Beast adjacent in tone, not sound.

Single press kit (60s read, print-ready):
  ${PRESS_URL}

TikTok-ready 15s vertical clip:
  ${CLIP_URL}

Master + publishing in-house. One-stop sync clearance available. Faith-positive cues welcome.

Worth a spin${org ? ' for ' + org : ''}?

— Brian (bZ)
brian@megabyte.space · +1 (469) 694-3696
`;
}

async function send(c) {
  const subject = `Newark hustle-gospel · "${TRACK_TITLE}" · press kit + sync`;
  const text = bodyFor(c);
  if (dry) {
    console.log('---');
    console.log(`To: ${c.email}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: c.email, subject, text, reply_to: 'brian@megabyte.space' })
  });
  if (!r.ok) {
    console.error('FAIL', c.email, r.status, (await r.text()).slice(0, 200));
    return;
  }
  const j = await r.json();
  console.log('SENT', c.email, j.id);
}

if (toArg) {
  await send({ name: 'Brian', org: 'test recipient', email: toArg });
} else if (sendAll && CURATORS.length) {
  for (const c of CURATORS) {
    await send(c);
    await new Promise(r => setTimeout(r, 800));
  }
} else if (sendAll && !CURATORS.length) {
  console.error('No curators configured. Add verified entries to CURATORS[] then re-run.');
  process.exit(1);
} else {
  console.log('Usage: node scripts/send-curator-outreach.mjs [--dry|--to=<email>|--all]');
}
