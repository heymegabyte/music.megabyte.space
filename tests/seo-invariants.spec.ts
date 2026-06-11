import { test, expect } from '@playwright/test';

// SEO / structured-data invariants, asserted against the live PROD_URL. These
// codify the manual audits the autonomous loop kept re-running by hand:
//   - sitemap.xml has <lastmod> on every <url> (always.md requirement)
//   - robots.txt never lists a UA as BOTH Allow:/ and Disallow:/ (regression
//     guard for the Cloudflare-managed-block contradiction fixed 2026-06-10)
//   - track-page JSON-LD parses + carries the right @types
//   - per-route og:image resolves and stays inside the ≤100KB branded-card budget
//
// HTTP-level checks (request fixture) — no JS, so they assert the server shell
// exactly as crawlers + social scrapers see it.

test.describe('SEO invariants (live shell)', () => {
  test('sitemap.xml: every <url> has a <lastmod>', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const urls = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    expect(urls.length, 'sitemap has entries').toBeGreaterThan(10);
    const missing = urls.filter(u => !u.includes('<lastmod>'));
    expect(missing.length, `${missing.length} <url> entries missing <lastmod>`).toBe(0);
  });

  test('robots.txt: no user-agent is both Allow:/ and Disallow:/', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const txt = await res.text();

    // Parse into groups: each run of `User-agent:` lines shares the rules below it.
    const verdict = new Map<string, Set<string>>();
    let agents: string[] = [];
    let sawRule = false;
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        if (sawRule) {
          agents = [];
          sawRule = false;
        }
        agents.push(line.split(':', 2)[1]!.trim());
      } else if (lower.startsWith('allow:') || lower.startsWith('disallow:')) {
        sawRule = true;
        const [k, v] = line.split(':', 2);
        if ((v ?? '').trim() === '/') {
          for (const a of agents) {
            const set = verdict.get(a) ?? new Set<string>();
            set.add(k!.trim().toLowerCase());
            verdict.set(a, set);
          }
        }
      }
    }
    const conflicts = [...verdict.entries()]
      .filter(([, s]) => s.has('allow') && s.has('disallow'))
      .map(([a]) => a);
    expect(conflicts, `UAs with contradictory root rules: ${conflicts.join(', ')}`).toEqual([]);
  });

  test('track page: JSON-LD parses and carries MusicRecording + BreadcrumbList', async ({ request }) => {
    const res = await request.get('/desiiignare/chef-lu-stew');
    expect(res.status()).toBe(200);
    const html = await res.text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      m => m[1]!
    );
    expect(blocks.length, 'has JSON-LD').toBeGreaterThanOrEqual(2);

    const types = new Set<string>();
    for (const b of blocks) {
      const parsed = JSON.parse(b); // throws → test fails on malformed JSON-LD
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) if (n && n['@type']) types.add(n['@type']);
    }
    expect(types.has('MusicRecording'), `@types present: ${[...types].join(', ')}`).toBe(true);
    expect(types.has('BreadcrumbList'), `@types present: ${[...types].join(', ')}`).toBe(true);

    const rec = blocks
      .map(b => JSON.parse(b))
      .flat()
      .find((n: { '@type'?: string }) => n?.['@type'] === 'MusicRecording');
    for (const field of ['name', 'byArtist', 'duration', 'datePublished', 'inAlbum']) {
      expect(rec[field], `MusicRecording.${field}`).toBeTruthy();
    }
  });

  test('track page og:image resolves and is within the 100KB card budget', async ({ request }) => {
    const html = await (await request.get('/desiiignare/chef-lu-stew')).text();
    const m = html.match(/<meta property="og:image" content="([^"]+)"/);
    expect(m, 'has og:image').toBeTruthy();
    const img = await request.get(m![1]!);
    expect(img.status(), `og:image ${m![1]} must resolve`).toBe(200);
    const bytes = (await img.body()).byteLength;
    expect(bytes, `og:image is ${(bytes / 1024).toFixed(0)}KB (budget 100KB)`).toBeLessThanOrEqual(
      100 * 1024
    );
  });
});
