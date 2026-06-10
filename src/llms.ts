// llms.txt (llmstxt.org) — served by the Worker at /llms.txt. Helps LLM crawlers
// (ChatGPT/Claude/Perplexity) + Lighthouse's agentic-browsing audit understand the
// catalog. Built from the same ALBUMS data so it never drifts. Spec needs an H1
// title + link sections.
import { ALBUMS } from './data';

const SITE = 'https://music.megabyte.space';

export function buildLlmsTxt(origin: string = SITE): string {
  const albums = [...ALBUMS]
    .sort((a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || ''))
    .map(a => `- [${a.name}](${origin}/${a.id}): ${a.tagline}`)
    .join('\n');
  return `# bZ — music.megabyte.space

> Hard but holy. Christian-gangster hustle gospel by bZ. An AI-native music project: every region of the homepage plays a different song, with a live Web Audio visualizer and word-by-word karaoke. Stream free, embed any track, cast to a TV.

## Albums
${albums}

## Pages
- [About bZ](${origin}/about): artist bio, theology, and how the music is made
- [Tracks](${origin}/credits): full track credits + provenance
- [Press](${origin}/press): press kit + embeddable players
- [Merch](${origin}/merch): apparel via Printful + Stripe checkout
- [The Appeal](${origin}/appeal): open letter from bZ

## Feeds
- [RSS feed](${origin}/feed.xml): every track, newest album first

## Optional
- [Privacy](${origin}/privacy): privacy policy
- [Terms](${origin}/terms): terms of use
`;
}
