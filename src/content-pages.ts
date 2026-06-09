/**
 * Content pages — About / Credits / Press / Merch.
 *
 * About is the consolidated hub: it absorbs the former Process, Theology,
 * Support, and Connect pages (those slugs 301 → /about in worker/index.ts).
 * Every page gets an auto-built sticky left-rail TOC from its <h4> section
 * dividers (renderContentPageTOC in main.ts); product-card titles
 * (.merch-card__title) are excluded so Merch's rail lists sections, not products.
 *
 * Each opens as a non-modal <dialog> over the main shell so the audio
 * element + visualizer keep playing across navigation. Routed by URL path.
 * Every page interleaves supporting imagery so it reads as a long-form
 * article, not a wall of text.
 */

import { SUNO_META } from './suno-meta';
import { TRACKS, ALBUMS } from './data';
import merchSuite from '../public/merch/suite.json';

export interface ContentPage {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  /** Per-page og:image card path (1200×630 jpg). Falls back to site default
   *  when missing. Drives Twitter Card + Open Graph unfurl previews. */
  ogImage?: string;
  /** SEO meta title — defaults to `${title} — bZ` when missing */
  metaTitle?: string;
  /** Long-form SEO description — defaults to description field */
  metaDescription?: string;
  /** Schema.org type for the per-page JSON-LD block. Defaults to 'WebPage'.
   *  Common choices: 'AboutPage' / 'ContactPage' / 'Article' / 'CollectionPage'. */
  jsonLdType?: 'AboutPage' | 'ContactPage' | 'Article' | 'CollectionPage' | 'WebPage';
  /** Suppress the auto-generated left-rail "On this page" TOC. Set on pages that
   *  ship their own in-content nav (e.g. Merch) so the two don't duplicate. */
  hideToc?: boolean;
  render: () => string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Section divider — a thin accent rule with optional kicker text. Rendered as an
// <h4> so the auto-built left-rail TOC (renderContentPageTOC, reads <h4>) picks up
// every section as a jump link. The .contentpage__divider class keeps the styling.
const divider = (label: string) =>
  `<h4 class="contentpage__divider"><span>${esc(label)}</span></h4>`;

// Pull-quote — large italicized callout with album-accent left border
const pullquote = (text: string, attribution = '') =>
  `<blockquote class="contentpage__pullquote">${esc(text)}${attribution ? `<cite>— ${esc(attribution)}</cite>` : ''}</blockquote>`;

// Inline DALL-E figure — 16:9 cinematic image with caption
const figure = (src: string, alt: string, caption: string) =>
  `<figure class="contentpage__figure">
    <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" />
    <figcaption>${esc(caption)}</figcaption>
  </figure>`;

// Highlight callout — bordered box for "did you know" / "fact" / "warning"
const highlight = (label: string, body: string) =>
  `<aside class="contentpage__highlight">
    <strong>${esc(label)}</strong>
    <p>${body}</p>
  </aside>`;

// Vertical timeline — each entry has date + title + body
const timeline = (entries: Array<{ date: string; title: string; body: string }>) =>
  `<ol class="contentpage__timeline">
    ${entries.map(e => `<li>
      <time>${esc(e.date)}</time>
      <h5>${esc(e.title)}</h5>
      <p>${e.body}</p>
    </li>`).join('')}
  </ol>`;

// 2-column grid of case-study cards
const cards = (items: Array<{ title: string; meta?: string; body: string }>) =>
  `<div class="contentpage__cards">
    ${items.map(c => `<article class="contentpage__card">
      <h5>${esc(c.title)}</h5>
      ${c.meta ? `<span class="contentpage__card-meta">${esc(c.meta)}</span>` : ''}
      <p>${c.body}</p>
    </article>`).join('')}
  </div>`;

// Inline album thumbnail row — clickable cover chips
const albumChip = (a: typeof ALBUMS[number]) =>
  `<a class="contentpage__album-chip" href="/${esc(a.id)}">
    <img src="${esc(a.cover)}" alt="" loading="lazy" />
    <span>${esc(a.name)}</span>
  </a>`;

export const CONTENT_PAGES: ContentPage[] = [

  // ═══ ABOUT ════════════════════════════════════════════════════════════
  {
    slug: 'about',
    title: 'About bZ',
    eyebrow: 'who is this',
    description: 'Brian Zalewski — Newark-based solo artist. Hustle-gospel music. Megabyte Labs founder. Hard but holy.',
    ogImage: '/og/og-about.jpg',
    metaTitle: 'About bZ — artist, theology, process, support',
    metaDescription: "Brian Zalewski is bZ — solo hustle-gospel artist out of Newark, NJ. The full story: bio, hard-but-holy theology, the 5-stage song-making process, how to support the studio, and how to connect. 6 albums, 50+ tracks.",
    jsonLdType: 'AboutPage',
    render: () => `
      <article class="contentpage__article">
        <figure class="contentpage__hero">
          <img src="/art/brian-zalewski.png" alt="Brian Zalewski" width="220" height="220" loading="lazy" />
          <figcaption>Brian Zalewski · Founder, Megabyte Labs · Newark, NJ</figcaption>
        </figure>

        <p class="contentpage__lead">
          bZ is Brian Zalewski — full-stack TypeScript developer turned hustle-gospel artist.
          15+ years of code, two decades of faith, one Newark-based one-person studio.
          <strong>Hard but holy.</strong>
        </p>

        ${pullquote(`Lifelong passion meets purpose — an open-source studio, a personal portfolio, and a launchpad for ideas worth building.`, 'Megabyte Labs manifesto')}

        ${figure('/art/pages/about-hero.png', 'Brian\'s studio at night', 'The studio · multiple monitors, mic, vinyl, Bible on the desk.')}

        ${divider('the artist')}
        <p>
          The catalog stitches together six albums (Panda Desiiignare, The Appeal, Halo,
          Wormhole Tape, Mercy Drop, St. John's Canon) spanning more than 50 tracks. Lyrics
          handwritten and refined with Suno. Audio production, mixing, visualizer engineering,
          and every line of this website ship from a one-person operation.
        </p>
        <p>
          Christian-gangster ethic. Robert Greene + Proverbs + Psalms on the same shelf.
          Reverent around family names. Zero drug references. Service-of-poor-and-needy
          is the throughline.
        </p>

        ${divider('the day job')}
        <p>
          Megabyte Labs is the open-source studio behind it all. Specialties: Angular,
          Ionic, Cordova — extended into robotics, home automation, DevOps, and
          infrastructure-as-code. Hundreds of public projects, millions of downloads.
        </p>
        <div class="contentpage__stats">
          <div><strong>15+</strong><span>years experience</span></div>
          <div><strong>100s</strong><span>open-source projects</span></div>
          <div><strong>millions</strong><span>downloads served</span></div>
          <div><strong>countless</strong><span>sites + apps shipped</span></div>
        </div>

        ${divider('origin')}
        <p>
          Born in Pennsylvania, raised between Pittsburgh and South Jersey, now anchored
          in Newark. The music started as catharsis — three decades of journaling that
          finally found a sound stack worth pouring into. The site you're reading is
          itself the proof-of-concept: one person, no label, full-stack from the lyric
          draft to the worker that's serving you these bytes.
        </p>

        ${divider('what bZ believes')}
        <ul class="contentpage__beliefs">
          <li><strong>The kingdom is now</strong> — the grind and the gospel are the same direction.</li>
          <li><strong>Family first</strong> — wife, kids, parents, in-laws referred to by name and protected by silence.</li>
          <li><strong>Discipline over dopamine</strong> — zero drug references, zero hedonism, full sincerity.</li>
          <li><strong>Service over spectacle</strong> — St. John's Soup Kitchen is the throughline, not the marketing.</li>
          <li><strong>Open source as worship</strong> — code published in the open is its own act of generosity.</li>
        </ul>

        ${divider('influences')}
        <p>
          Lecrae · Andy Mineo · Beautiful Eulogy · NF · Tobe Nwigwe · Killer Mike ·
          Robert Greene's <em>48 Laws of Power</em> · the Psalms · the Sermon on the Mount ·
          Brooklyn block-history · Spanish street idioms · the Megabyte Labs open-source corpus.
        </p>

        ${figure('/art/pages/about-studio-2.png', 'Hands writing lyrics in a leather notebook by warm desk-lamp light', "Lyric draft · the only stage of the pipeline that's 100% human.")}

        ${divider('tools + setup')}
        <ul class="contentpage__stack">
          <li><strong>Music gen</strong>Suno v3.5 / v4 / v4.5</li>
          <li><strong>Lyric align</strong>OpenAI Whisper + Needleman-Wunsch</li>
          <li><strong>BPM detect</strong>aubio FFT beat tracker (Python)</li>
          <li><strong>Web stack</strong>Cloudflare Workers + vanilla TS + Vite</li>
          <li><strong>AI chat</strong>Cloudflare Workers AI · Llama 3.3 70B</li>
          <li><strong>Distribution</strong>oEmbed · Twitter Player · web component <code>&lt;bzmusic-player&gt;</code></li>
          <li><strong>Email</strong>Listmonk (self-hosted) · double opt-in</li>
          <li><strong>Payments</strong>Square (donations) · Stripe (consulting)</li>
        </ul>

        ${divider('the catalog')}
        <p>Six albums to date. Click any cover to open it in the player.</p>
        <div class="contentpage__album-grid">
          ${ALBUMS.map(albumChip).join('')}
        </div>

        ${divider('the journey')}
        ${timeline([
          { date: '2011', title: 'First public open-source commit', body: 'Cordova plugins, Stencil components. The Megabyte Labs corpus starts taking shape.' },
          { date: '2018', title: 'Megabyte Labs founded', body: 'Personal brand → open-source studio with hundreds of projects, millions of downloads.' },
          { date: '2024', title: 'Suno v3 launches', body: 'First experiments with AI-generated music. Hand-written lyrics + machine-rendered takes click immediately.' },
          { date: '2025', title: 'Panda Desiiignare drops', body: 'First public bZ album. Hustle-gospel born.' },
          { date: '2026', title: "St. John's Canon + Mercy Drop", body: 'Six-album catalog. Whisper-aligned karaoke + Workers AI chat + cinematic visualizers all shipping from a one-person studio.' },
        ])}

        ${divider('daily rhythm')}
        ${cards([
          { title: 'Mornings · code', meta: '6am-12pm', body: 'Megabyte Labs consulting + open-source maintenance. Deep work block when caffeine + circadian focus peak.' },
          { title: 'Afternoons · family', meta: '12-6pm', body: 'Wife. Kids. Real life. No phone, no laptop, no Slack. The day-job hard-stops.' },
          { title: 'Evenings · music', meta: '8-11pm', body: 'Lyric drafts, Suno takes, audio analysis. The hustle-gospel studio runs on the late shift.' },
          { title: 'Sunday · church + reset', meta: 'all day', body: 'Sabbath proper. No code, no email. The week resets in a pew + at a soup kitchen.' },
        ])}

        ${divider('the theology · hard but holy')}
        <p>
          "Hard but holy" isn't a brand line — it's the working theology behind every track.
          The anchor is <strong>James 1:27</strong>: "Pure and undefiled religion before God
          is this: to visit orphans and widows in their trouble, and to keep oneself unspotted
          from the world." Visit orphans + widows = service. Unspotted from the world =
          discipline. Hard but holy is just James 1:27 set to 808s.
        </p>
        ${pullquote(`Win through your actions, never through argument.`, 'Robert Greene · Law 9 — recurring lyric across the catalog')}

        ${divider('what you will + won’t hear')}
        ${cards([
          { title: 'What you will hear', body: 'Reverence around family — by name and by silence. Discipline framed as freedom. Service of the poor as the throughline. Scripture quoted with chapter + verse. Robert Greene’s 48 Laws as wisdom literature.' },
          { title: 'What you won’t hear', body: 'Zero drug references, by editorial rule. No misogyny — every woman treated as image-bearer. No cheap grace, no triumphalism. Strong words only in service of weight, never edge.' },
        ])}
        <p>
          "Christian-gangster" isn't an oxymoron — it's lineage. David ran a Robin Hood
          operation in the Judean wilderness before he was king. Jesus flipped the temple
          tables. The cross is a hard place; holiness was never gentle. Weight in the
          production, truth in the lyric, reverence in the family treatment — the only
          triangle that holds.
        </p>

        ${divider('three pillars')}
        ${cards([
          { title: 'Mercy', meta: 'James 2:13', body: '"Mercy triumphs over judgment." Every track assumes the listener is hurting somehow, and meets that hurt without flinching, without exploiting.' },
          { title: 'Discipline', meta: 'Hebrews 12:11', body: '"No discipline seems pleasant at the time." The kingdom + the grind point the same direction. The editorial rules are non-negotiable for a reason.' },
          { title: 'Service', meta: 'Matthew 25:40', body: `"Whatever you did for the least of these, you did for me." St. John's Soup Kitchen of Newark is the throughline — not the marketing.` },
        ])}

        ${divider('on AI in worship music')}
        <p>
          Suno is a tool, not a co-author. <strong>Every lyric is human-written.</strong> The
          model renders the take; the human decides what ships — no different from a vocalist
          using a microphone they didn't engineer. If the model improvises a line that lands,
          it gets written down, judged on its own merit, and re-prompted as a deliberate edit
          or rejected. The human is always the last editor.
        </p>
        <details>
          <summary>Is this safe to play in church?</summary>
          <p>Halo + St. John's Canon are. Panda Desiiignare + Wormhole Tape lean experimental — vibe-check first. The Appeal is the open letter to family; listen before deciding.</p>
        </details>
        <details>
          <summary>Is the AI-music thing a gimmick?</summary>
          <p>No. AI is just the latest synthesizer. Multi-track tape, drum machines, autotune, DAWs, sampling — every generation of music tech was called a gimmick first. Suno makes solo full-band production accessible to one bedroom producer.</p>
        </details>

        ${divider('how a song gets made')}
        <p>
          Every bZ track is human-directed, AI-augmented. No prompt-and-pray. Each song ships
          through a five-stage pipeline before it ever lands on the site.
        </p>
        ${figure('/art/pages/process-pipeline.png', 'The 5-stage pipeline visualization', 'Lyric → Suno → Whisper → audio analysis → visual. Five stages, one song.')}
        <ol class="contentpage__steps">
          <li><strong>Concept + lyric draft</strong> — handwritten, anchored on a verse, a vibe, or a single line that won't let go.</li>
          <li><strong>Suno generation</strong> — refined lyrics + a tight style tag through Suno v3.5/v4/v4.5. Usually 4-12 takes until the vibe lands; full provenance saved per-track in <code>SUNO_META</code>.</li>
          <li><strong>Whisper alignment</strong> — word-by-word timing via OpenAI Whisper-1, post-processed with Needleman-Wunsch so karaoke hits the right syllable.</li>
          <li><strong>Audio analysis</strong> — aubio FFT extracts measured BPM + key so visualizer presets snap to tempo from frame zero.</li>
          <li><strong>Visual + UI</strong> — six WebGL visualizers, Web Audio FFT engine, per-album palette, cinematic transitions, plus a shareable embed widget per release.</li>
        </ol>

        ${divider('editorial rules · non-negotiable')}
        <ul>
          <li>Zero drug references. Discipline over dopamine.</li>
          <li>Family names handled with reverence — Brian, Laura, Adrian, CK.</li>
          <li>Sharp + punchy. Active voice. Action-verb CTAs. Flesch ≥ 60.</li>
          <li>Banned slop words (limitless, leverage, robust…) get rejected at edit.</li>
          <li>Service-of-poor-and-needy stays the throughline.</li>
        </ul>

        ${divider('anatomy of one track')}
        <p>"Chef Lu Stew" from Panda Desiiignare, start to finish:</p>
        ${cards([
          { title: '1 · Verse caught me', meta: 'Mark 6:42', body: '"They all ate and were satisfied" — the feeding of the 5,000. Image of a chef feeding the line.' },
          { title: '2 · Lyric draft', meta: '~45min · pen + paper', body: 'Three verses, two-line chorus. Hook: "Chef Lu in the kitchen, fire in the pot." Repeats four times.' },
          { title: '3 · Suno take', meta: '~2h · 7 takes', body: '<code>boom bap, jazz piano, vinyl crackle, 88 bpm, no autotune</code>. Take 5 nailed it; 1-4 drifted on tempo.' },
          { title: '4 · Whisper align', meta: '~3min', body: '247 words mapped to timestamps; Needleman-Wunsch repaired 4 misalignments where Suno blurred syllables.' },
          { title: '5 · BPM measure', meta: '~30s', body: 'aubio confirmed 87.4 bpm, C minor at 0.92 confidence. Visualizer locked to the tempo grid.' },
          { title: '6 · Shipped', meta: '/desiiignare/chef-lu-stew', body: 'Most-shared track of the album. Played at a parish soup-kitchen benefit.' },
        ])}
        ${highlight('~$0.42 per shipped track', `
          Suno credits ~$0.30 amortized across the monthly plan, Whisper-1 ~$0.02, aubio free,
          Sharp + Cloudflare Workers ~$0.10/track for storage + delivery over its lifetime.
        `)}

        ${divider('support the studio')}
        <p>
          The studio runs lean — one person, open-source stack, no label deal. Five ways to
          keep it independent, in ascending order of commitment. The free options matter most.
        </p>
        <ol class="contentpage__steps">
          <li><strong>Share a track</strong> (free) — the highest-leverage move. Open any track, hit share, send to one friend who'd actually listen.</li>
          <li><strong>Subscribe to drops</strong> (free) — one email per album. Open the AI chat (⌘K) or any album footer. Listmonk, double opt-in, never resold.</li>
          <li><strong>Tip</strong> — one-time via <a href="https://www.paypal.me/HeyMegabyte" target="_blank" rel="noopener">paypal.me/HeyMegabyte ↗</a>. Every $5 ≈ 1,700 Spotify streams.</li>
          <li><strong>Sponsor</strong> — recurring via <a href="https://github.com/sponsors/HeyMegabyte" target="_blank" rel="noopener">github.com/sponsors/HeyMegabyte ↗</a>. Predictable runway = committed drop dates.</li>
          <li><strong>Hire the studio</strong> — TypeScript / Cloudflare / mobile work via <a href="https://megabyte.space/connect/" target="_blank" rel="noopener">megabyte.space/connect ↗</a>. The most direct way to fund the music.</li>
        </ol>
        ${highlight('Where the money goes', `
          Studio cost stack runs ~$75/mo: Cloudflare Workers + R2 + KV (~$30), Suno + Whisper
          (~$20), domain + email + DNS (~$15), Listmonk VPS (~$10). Any surplus routes to
          <strong>St. John's Soup Kitchen of Newark</strong> — serving daily meals since 1981.
          Donate directly at <a href="https://www.njsk.org/" target="_blank" rel="noopener">njsk.org ↗</a>.
          First annual transparency report drops January 2027.
        `)}

        ${divider('what shaped the thinking')}
        <ul>
          <li><em>The 48 Laws of Power</em> — Robert Greene (read 3×, marked up)</li>
          <li><em>The Sermon on the Mount</em> — Matthew 5-7 (re-read annually)</li>
          <li><em>Atomic Habits</em> — James Clear (the discipline scaffold)</li>
          <li><em>Show Your Work</em> — Austin Kleon (why this whole site exists)</li>
          <li><em>The Pragmatic Programmer</em> — Hunt + Thomas (the engineering operating system)</li>
          <li>The Psalms — anchor when nothing else does</li>
        </ul>

        ${divider("what's next")}
        ${highlight('Roadmap · 2026-2027', `
          New album every 2 months. First public live show pencilled for Q3 2026.
          The St. John's Canon fundraising hits $10K-give-back milestone. The
          <code>&lt;bzmusic-player&gt;</code> web component publishes to npm.
          Workers AI chat gains web-research deep-mode.
        `)}

        ${divider('connect · best path by intent')}
        <p>A real human reads every message. Replies within 48 hours unless travelling.</p>
        <ul class="contentpage__connect">
          <li><strong>Booking + licensing</strong> — <a href="mailto:brian@megabyte.space?subject=bZ%20booking">brian@megabyte.space</a></li>
          <li><strong>Press + interviews</strong> — <a href="mailto:brian@megabyte.space?subject=bZ%20press">brian@megabyte.space</a> with "press" in the subject · full kit at <a href="/press" data-content-page="press">/press</a></li>
          <li><strong>Time-sensitive</strong> — <a href="tel:+14696943696">+1 (469) 694-3696</a> (voicemail returned within 24h weekdays)</li>
          <li><strong>Prayer requests</strong> — DM any social or email; handled privately, never published</li>
          <li><strong>Tech consulting</strong> — via <a href="https://megabyte.space/connect/" target="_blank" rel="noopener">megabyte.space/connect ↗</a></li>
        </ul>
        ${highlight('Faster replies if you do these first', `
          <strong>1.</strong> Skim this page — many answers live here.<br>
          <strong>2.</strong> Include specifics (venue date, capacity, project link) instead of "let's hop on a call."<br>
          <strong>3.</strong> For licensing, name the use case (sync, sample, cover, performance).<br>
          <strong>4.</strong> Send one well-formed email instead of three fragments. NDAs signed on request.
        `)}

        ${divider('social + studio')}
        <ul class="contentpage__connect">
          <li><a href="https://megabyte.space" target="_blank" rel="noopener">megabyte.space — main studio site ↗</a></li>
          <li><a href="https://github.com/HeyMegabyte" target="_blank" rel="noopener">GitHub · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.linkedin.com/company/megabyte-labs" target="_blank" rel="noopener">LinkedIn · Megabyte Labs ↗</a></li>
          <li><a href="https://twitter.com/HeyMegabyte" target="_blank" rel="noopener">X / Twitter · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.instagram.com/heymegabyteofficial/" target="_blank" rel="noopener">Instagram · @heymegabyteofficial ↗</a></li>
          <li><a href="https://www.youtube.com/@HeyMegabyte" target="_blank" rel="noopener">YouTube · @HeyMegabyte ↗</a></li>
        </ul>
      </article>
    `,
  },

  // ═══ CREDITS ══════════════════════════════════════════════════════════
  {
    slug: 'credits',
    title: 'Per-track provenance',
    eyebrow: 'every song, every dna',
    description: 'Suno model, BPM source, generation date — auto-rendered from SUNO_META so the catalog audits itself.',
    ogImage: '/og/og-credits.jpg',
    metaTitle: 'Credits — per-track DNA + tool credits + licensing',
    metaDescription: 'Every bZ track shows its Suno model, BPM source, key, generation date. Tool credits, OSS honor roll, licensing summary. Full transparency.',
    jsonLdType: 'CollectionPage',
    render: () => {
      const rows = TRACKS.map(t => {
        const m = SUNO_META[t.id];
        if (!m) return null;
        const album = ALBUMS.find(a => a.id === t.album);
        return `<tr>
          <td><strong>${esc(t.title)}</strong><br /><small>${esc(album?.name ?? '')}</small></td>
          <td>${esc(m.sunoModelName ?? m.sunoModel ?? '—')}</td>
          <td>${m.sunoBpm ? `${Math.round(m.sunoBpm)} bpm` : '—'}<br /><small>${esc(m.sunoBpmSource ?? '')}</small></td>
          <td>${esc(m.sunoKey ?? '—')}<br /><small>${esc(m.sunoKeySource ?? '')}</small></td>
          <td>${m.sunoCreatedAt ? esc(m.sunoCreatedAt.slice(0, 10)) : '—'}</td>
          <td>${m.sunoId ? `<a href="https://suno.com/song/${esc(m.sunoId)}" target="_blank" rel="noopener">↗</a>` : '—'}</td>
        </tr>`;
      }).filter(Boolean).join('');
      const stats = {
        total: TRACKS.length,
        withSuno: TRACKS.filter(t => SUNO_META[t.id]).length,
        withBpm: TRACKS.filter(t => SUNO_META[t.id]?.sunoBpm).length,
        withKey: TRACKS.filter(t => SUNO_META[t.id]?.sunoKey).length,
      };
      return `
        <article class="contentpage__article">
          <p class="contentpage__lead">
            Transparency first. Every track shows its Suno DNA — model, BPM, key,
            generation date — so anyone studying the AI-music pipeline can see exactly
            what shipped.
          </p>

          ${figure('/art/pages/credits-data-viz.png', 'Frequency bars data visualization', 'Every track gets measured. BPM + key + spectrum logged from generation through ship.')}

          <div class="contentpage__stats">
            <div><strong>${stats.total}</strong><span>total tracks</span></div>
            <div><strong>${stats.withSuno}</strong><span>full provenance</span></div>
            <div><strong>${stats.withBpm}</strong><span>measured BPM</span></div>
            <div><strong>${stats.withKey}</strong><span>detected key</span></div>
          </div>

          ${divider('data sources')}
          <ul>
            <li><strong>tag</strong> — value parsed from Suno's style/genre tags at generation time</li>
            <li><strong>audio</strong> — measured via aubio FFT analysis on the rendered MP3</li>
          </ul>

          ${divider('per-track table')}
          <div class="contentpage__table-wrap">
            <table class="contentpage__table">
              <thead><tr><th>Track</th><th>Model</th><th>BPM</th><th>Key</th><th>Made</th><th>↗</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          ${divider('lyric timing')}
          <p>
            Every track ships with word-by-word timing data (whisper-aligned via
            Needleman-Wunsch) at <code>/lyrics/&lt;id&gt;.json</code>. That powers the
            karaoke overlay + fullscreen lyrics + the np-panel live lyric preview.
            Download per-track <code>.txt</code> + <code>.lrc</code> from the album-art
            modal of any playing track.
          </p>

          ${divider('tool credits')}
          <ul class="contentpage__stack">
            <li><strong>Music gen</strong><a href="https://suno.com" target="_blank" rel="noopener">Suno ↗</a> v3.5 / v4 / v4.5</li>
            <li><strong>Lyric align</strong><a href="https://github.com/openai/whisper" target="_blank" rel="noopener">OpenAI Whisper ↗</a></li>
            <li><strong>BPM + key</strong><a href="https://aubio.org/" target="_blank" rel="noopener">aubio ↗</a> FFT</li>
            <li><strong>Image processing</strong><a href="https://sharp.pixelplumbing.com/" target="_blank" rel="noopener">Sharp ↗</a></li>
            <li><strong>Edge runtime</strong><a href="https://workers.cloudflare.com/" target="_blank" rel="noopener">Cloudflare Workers ↗</a></li>
            <li><strong>AI chat</strong><a href="https://developers.cloudflare.com/workers-ai/" target="_blank" rel="noopener">Workers AI / Llama 3.3 70B ↗</a></li>
            <li><strong>Visualizer</strong>Web Audio API + WebGL via custom shaders</li>
            <li><strong>Build</strong><a href="https://vitejs.dev/" target="_blank" rel="noopener">Vite ↗</a> · <a href="https://typescriptlang.org" target="_blank" rel="noopener">TypeScript ↗</a></li>
          </ul>

          ${divider('licensing')}
          <p>
            All bZ recordings are © Brian Zalewski / Megabyte Labs, all rights reserved.
            Lyrics + audio are NOT Creative Commons — please email
            <a href="mailto:brian@megabyte.space?subject=bZ%20licensing">brian@megabyte.space</a>
            for sample clearance, sync licensing, or cover-rights requests.
          </p>

          ${divider('special thanks')}
          <p>
            Family · St. John's Soup Kitchen volunteers · the open-source maintainers of
            every dependency in <code>package.json</code> · every subscriber who clicked
            through on a first-listen email · every friend who shared a track.
          </p>

          ${figure('/art/pages/credits-spectrum.png', 'Frequency spectrum analyzer in cyan', 'Every measurement saved per-track. Reproducible, auditable, transparent.')}

          ${divider('honor roll')}
          <p>Specific open-source maintainers whose work this catalog rides on:</p>
          ${cards([
            { title: 'Lovell Fuller', meta: 'maintainer · sharp', body: 'Sharp is the image-processing workhorse behind every cover render, favicon set, and DALL-E optimization on this site.' },
            { title: 'Evan You', meta: 'creator · Vite', body: 'Vite makes the dev loop fast enough that the whole UI can be re-shipped in a single evening. The reason this site has shipped dozens of iterations.' },
            { title: 'Paul Adenot', meta: 'spec editor · Web Audio API', body: 'The Web Audio API spec work made browser-native FFT analysis a one-liner. Every visualizer + the karaoke alignment owes him.' },
            { title: 'Daniel Stenberg', meta: 'creator · curl', body: 'curl is the silent dependency under every script in /scripts/. The fetch backbone of the entire pipeline.' },
          ])}

          ${divider('model version history')}
          ${timeline([
            { date: 'Q3 2024', title: 'Suno v3 first takes', body: 'Initial experiments. Lyric coherence weak; vibes occasionally landed.' },
            { date: 'Q4 2024', title: 'Suno v3.5 — Panda starts', body: 'Coherence + length improved. First catalog-worthy tracks shipped.' },
            { date: 'Q2 2025', title: 'Suno v4 — Halo + Appeal', body: 'Vocal clarity jumps. Stretched takes from 90s to 3+ min reliably.' },
            { date: 'Q4 2025', title: 'Suno v4.5 — Wormhole + Mercy + Canon', body: 'Style-tag honoring much tighter. Most takes ship now ship from generation 1-3.' },
            { date: '2026', title: 'Workers AI Llama 3.3 70B', body: "In-app DJ chat backend swapped from Anthropic Claude to Cloudflare's free-tier Llama. ~40% latency improvement, $0 per chat." },
          ])}

          ${divider('made on')}
          ${highlight('Geography matters', `
            Every track was made in Newark, NJ — the same metro as the named subjects of
            half the songs. St. John's Soup Kitchen sits 4 blocks from the studio.
            Sacred Heart Cathedral 6 blocks. The Passaic River 12 blocks. Specificity is
            the gospel — abstraction is the enemy.
          `)}

          ${divider('licensing summary')}
          ${cards([
            { title: 'Listening · personal use', meta: 'free', body: 'Stream, download, share, add to your personal playlists. Always free.' },
            { title: 'Sync · film, TV, web', meta: 'license required', body: 'Email brian@megabyte.space with project details + duration. Most non-commercial uses approved within 48 hours, free of charge.' },
            { title: 'Sampling · for your own track', meta: 'usually yes', body: 'Email with the sample + your track. Almost always yes, no fee, just need attribution + a link.' },
            { title: 'Cover · live or recorded', meta: 'always yes', body: 'Just record + share. No paperwork needed. Tag @HeyMegabyte so I can hear it.' },
          ])}
        </article>
      `;
    },
  },

  // ═══ PRESS ════════════════════════════════════════════════════════════
  {
    slug: 'press',
    title: 'Press kit',
    eyebrow: 'for writers, curators, programmers',
    description: 'One-page everything-you-need. Bio + hi-res covers + EPK + booking.',
    ogImage: '/og/og-press.jpg',
    metaTitle: 'Press kit — bios, covers, brand assets, booking',
    metaDescription: '50-word + 150-word bios. Hi-res cover art (6 albums). Headshot. Brand voice. Booking + licensing. Interview answers. Embed snippets. Everything writers and curators need.',
    jsonLdType: 'AboutPage',
    render: () => {
      const covers = ALBUMS.map(a => `
        <a class="contentpage__cover" href="${esc(a.cover)}" target="_blank" rel="noopener" title="Open ${esc(a.name)} cover full-res">
          <img src="${esc(a.cover)}" alt="${esc(a.name)} cover art" loading="lazy" />
          <span>${esc(a.name)}</span>
        </a>
      `).join('');
      return `
        <article class="contentpage__article">
          ${divider('one-line')}
          <p class="contentpage__lead">
            bZ — hustle-gospel. Newark, NJ. Christian-gangster ethic. Hard but holy.
            ${TRACKS.length} tracks across ${ALBUMS.length} albums.
          </p>

          ${divider('quick facts')}
          <ul class="contentpage__stack">
            <li><strong>Artist</strong>bZ (Brian Zalewski)</li>
            <li><strong>Based</strong>Newark, NJ</li>
            <li><strong>Founded</strong>2025 · personal studio · no label</li>
            <li><strong>Catalog</strong>${ALBUMS.length} albums · ${TRACKS.length} tracks</li>
            <li><strong>Genre</strong>hustle gospel · christian hip-hop · electronic worship</li>
            <li><strong>Style</strong>chrome trap · griot folk · cinematic worship · boom bap</li>
            <li><strong>Tools</strong>Suno + Whisper + Web Audio API</li>
          </ul>

          ${divider('bio · 50 words')}
          <p>
            bZ is Brian Zalewski, a Newark-based solo artist building hustle-gospel music
            at the intersection of street-real honesty and Christian devotional traditions.
            Lyrics handwritten and refined with Suno. Audio production, visualizer engineering,
            and distribution ship from a one-person operation.
          </p>

          ${divider('bio · 150 words')}
          <p>
            bZ (Brian Zalewski) is a Newark-based solo artist building hustle-gospel music
            at the intersection of Brooklyn street-real honesty and Christian devotional
            traditions. Six albums to date span Panda Desiiignare, The Appeal, Halo, Wormhole
            Tape, Mercy Drop, and St. John's Canon — over fifty tracks total. Lyrics are
            handwritten and refined with Suno's generative models, then word-aligned with
            OpenAI Whisper for live karaoke playback. Every line of the playback site,
            visualizers, and AI DJ chat ships from a one-person operation. Day job:
            founder of Megabyte Labs, an open-source studio with hundreds of public
            projects and millions of downloads. Editorial rule set: zero drug references,
            reverence around family names, service-of-poor-and-needy as the throughline.
          </p>

          ${divider('selected lyric quotes')}
          ${pullquote(`Mama called us baby sharks in the dark`, 'Mama Called Us — The Appeal')}
          ${pullquote(`Win through your actions, never through argument`, 'Eisenhower Matrix — Wormhole Tape')}
          ${pullquote(`Chef Lu in the kitchen, fire in the pot, brand new child of God`, 'Chef Lu Stew — Panda Desiiignare')}

          ${divider('per-track press kits')}
          <p style="color: var(--ink-mute); font-size: 0.86rem;">
            Every track ships a dedicated one-pager — bio, hi-res cover, streaming links,
            lyric excerpt, sync availability, contact. Send a journalist or curator one URL.
          </p>
          <ul class="contentpage__press-list">
            ${ALBUMS.map(a => {
              const tracks = a.trackIds.map(id => TRACKS.find(t => t.id === id)).filter(Boolean);
              if (!tracks.length) return '';
              return `<li>
                <h5>${esc(a.name)}</h5>
                <div class="contentpage__press-grid">
                  ${tracks.map(t => `<a class="contentpage__press-chip" href="/press/${esc(t!.id)}">
                    <span>${esc(t!.title)}</span>
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
                  </a>`).join('')}
                </div>
              </li>`;
            }).join('')}
          </ul>

          ${divider('hi-res cover art')}
          <p style="color: var(--ink-mute); font-size: 0.86rem;">Click any cover to open the full-res original — all are © Brian Zalewski / Megabyte Labs.</p>
          <div class="contentpage__covers">${covers}</div>

          ${divider('artist photo')}
          <figure class="contentpage__hero" style="margin: 4px 0 20px;">
            <img src="/art/brian-zalewski.png" alt="Brian Zalewski headshot" width="200" height="200" loading="lazy" />
            <figcaption>
              <a href="/art/brian-zalewski.png" target="_blank" rel="noopener">Download full-res ↗</a>
            </figcaption>
          </figure>

          ${divider('brand voice')}
          <ul>
            <li>Sharp · punchy · irreverent</li>
            <li>Christian-gangster ethic — hard but holy</li>
            <li>Action-verb CTAs · zero hype · Flesch ≥ 60</li>
            <li>Robert Greene + Psalms + Newark slang same shelf</li>
          </ul>

          ${divider('booking + licensing')}
          <p>
            Email <a href="mailto:brian@megabyte.space?subject=bZ%20booking">brian@megabyte.space</a>
            with subject line "bZ booking" or "bZ licensing" — reply within 48 hours.
            Phone <a href="tel:+14696943696">+1 (469) 694-3696</a> for time-sensitive press.
          </p>

          ${divider('also for tech press')}
          <p>
            The site itself is the story: vanilla TypeScript SPA, Cloudflare Workers edge,
            Workers AI (Llama 3.3) for the in-app DJ chat, Web Audio API for the visualizer
            engine, Whisper-aligned karaoke. One-person stack proves that the AI music wave
            can be fully self-hosted. Happy to chat about the engineering — same email.
          </p>

          ${figure('/art/pages/press-magazine.png', 'Magazine spread mockup on a dark wooden table', 'Press kit ready for editorial feature placement.')}

          ${divider('most-asked interview questions')}
          <details>
            <summary>Why did you start making music with AI?</summary>
            <p>
              Because the music in my head finally had a stack that could render it. I've journaled
              for 25 years but never picked up an instrument seriously. Suno collapsed the
              instrument-skill barrier to zero, which left only the question I actually cared about:
              what do you have to say?
            </p>
          </details>
          <details>
            <summary>What makes "hustle gospel" different from "Christian hip-hop"?</summary>
            <p>
              Christian hip-hop usually has an apologetic posture — "we're Christians who happen
              to rap." Hustle gospel inverts: the gospel IS the hustle. Both directions point the
              same place. Less defensive, more aggressive.
            </p>
          </details>
          <details>
            <summary>How much of the lyrics are human-written?</summary>
            <p>
              100% of shipped lyrics. Suno renders the take; the human decides what ships. If
              the model improvises a line that lands, it gets written down + re-prompted as a
              deliberate edit, not accepted as the model's own creation.
            </p>
          </details>
          <details>
            <summary>What's your relationship to St. John's Soup Kitchen?</summary>
            <p>
              Volunteer + named album tribute. The St. John's Canon album is a literal soup-kitchen
              liturgy. A portion of every support tier routes back to njsk.org.
            </p>
          </details>
          <details>
            <summary>Is this a label-funded project?</summary>
            <p>
              No. Solo studio, no label deal, no investors, no advance. The day job (Megabyte Labs
              consulting) funds the music. Every dollar of listener support extends the runway.
            </p>
          </details>

          ${divider('embed the player on your site')}
          <p>Three lines of HTML — works on any site, no framework required:</p>
          <pre class="contentpage__code"><code>&lt;script src="https://bzmusic.win/embed.js" defer&gt;&lt;/script&gt;
&lt;bzmusic-player track="chef-lu-stew"&gt;&lt;/bzmusic-player&gt;</code></pre>
          <p>Or iframe directly (works in Substack, Notion, WordPress):</p>
          <pre class="contentpage__code"><code>&lt;iframe src="https://music.megabyte.space/embed/desiiignare/chef-lu-stew"
        width="480" height="220" frameborder="0"
        allow="autoplay; encrypted-media"&gt;&lt;/iframe&gt;</code></pre>

          ${divider('logo + brand assets')}
          ${cards([
            { title: 'bz-icon.png', meta: 'transparent · graffiti glyph', body: '<a href="/art/bz-icon.png" target="_blank" rel="noopener">Download ↗</a> · use for header/wordmark applications' },
            { title: 'bz-app-icon.png', meta: '1024×1024 · halo + dark bg', body: '<a href="/art/bz-app-icon.png" target="_blank" rel="noopener">Download ↗</a> · use for app icon / square contexts' },
            { title: 'brian-zalewski.png', meta: '400×400 headshot', body: '<a href="/art/brian-zalewski.png" target="_blank" rel="noopener">Download ↗</a> · use for bylines + author pages' },
          ])}
        </article>
      `;
    },
  },

  // ═══ MERCH ════════════════════════════════════════════════════════════
  {
    slug: 'merch',
    title: 'Merch',
    eyebrow: 'free satan · it’s animal abuse',
    description: 'The full FREE SATAN apparel suite. Hoodies, tees, tanks, more.',
    ogImage: '/merch/mockups/tee-1717-pepper.png',
    metaTitle: 'Merch — bZ · FREE SATAN apparel suite',
    metaDescription: 'The full FREE SATAN — It’s Animal Abuse apparel suite. Comfort Colors heavyweight tees, hoodies, long-sleeves, tanks. DTG print, ships worldwide via Printful.',
    jsonLdType: 'WebPage',
    render: () => `
      <article class="contentpage__article merch-page">
       <div class="merch-main">

        <div class="merch-hero">
          <div class="merch-hero__art">
            <img src="/merch/design-free-satan.png" alt="FREE SATAN — It’s Animal Abuse · cream graffiti headline, caged red devil, banner subtitle" loading="eager" decoding="async" fetchpriority="high" />
          </div>
          <div class="merch-hero__copy">
            <p class="merch-hero__eyebrow">the design</p>
            <h3 class="merch-hero__head">FREE SATAN<br/><span>it’s Animal Abuse</span></h3>
            <p class="merch-hero__blurb">
              Cream graffiti headline drop-shadowed in red. Caged devil in iron bars,
              padlocked from the outside. Banner subtitle in italic script.
              Reads punk on first scan; orthodox theology on the second
              (Christ harrowed hell — 1 Peter 3:18-20). The shirt invites the
              conversation; the conversation is the gospel.
            </p>
            <ul class="merch-hero__stats">
              <li><strong>${merchSuite.items.filter((i: any) => i.mockup).length}</strong><span>products</span></li>
              <li><strong>XS-3XL</strong><span>sizes</span></li>
              <li><strong>DTG</strong><span>print method</span></li>
              <li><strong>5-7d</strong><span>ships in</span></li>
            </ul>
          </div>
        </div>

        <h4 class="contentpage__divider" id="merch-suite"><span>the suite</span></h4>
        <div class="merch-grid">
          ${merchSuite.items.filter((i: any) => i.mockup).map((item: any, idx: number) => `
            <a class="merch-card" href="${esc(item.storefrontUrl)}" target="_blank" rel="noopener noreferrer" data-idx="${idx}">
              ${idx === 0 ? '<span class="merch-card__badge">PRIMARY</span>' : ''}
              ${item.productId ? '<span class="merch-card__badge merch-card__badge--live">LIVE</span>' : ''}
              <div class="merch-card__art"${item.backgroundHex ? ` style="background:${esc(item.backgroundHex)}"` : ''}>
                <img src="${esc(item.mockup)}" alt="${esc(item.title)} mockup on ${esc(item.blank)} in ${esc(item.color)}" loading="lazy" decoding="async" />
              </div>
              <div class="merch-card__body">
                <h4 class="merch-card__title">${esc(item.title)}</h4>
                <p class="merch-card__meta">${esc(item.blank)} · ${esc(item.color)}${item.variantCount ? ` · ${item.variantCount} sizes` : ''}</p>
                <p class="merch-card__blurb">${esc(item.blurb)}</p>
                <div class="merch-card__cta">
                  <span class="merch-card__price">$${item.price}</span>
                  <span class="merch-card__buy">View ↗</span>
                </div>
              </div>
            </a>
          `).join('')}
        </div>

        <p style="text-align:center; color:var(--ink-mute); font-size:0.85rem; margin-top:18px;">
          Pick a size · tap <strong>Add</strong> · checkout right here. Payments by Stripe ·
          fulfillment by Printful (5-7 day US ship). Prefer the storefront?
          <a href="https://bz-music.printful.me" target="_blank" rel="noopener noreferrer">bz-music.printful.me ↗</a>.
        </p>

        <h4 class="contentpage__divider" id="merch-meaning"><span>what it means</span></h4>
        <p>
          “FREE SATAN” on the headline + “it’s Animal Abuse” on the banner
          stages the joke that frames the gospel. Christ descended into hell and emancipated the
          captives (1 Peter 3:18-20, Apostles’ Creed). The shirt invites the conversation.
          If you don’t want to have that conversation, this isn’t the shirt.
        </p>

        <h4 class="contentpage__divider" id="merch-blanks"><span>the blanks</span></h4>
        <ul>
          <li><strong>Comfort Colors 1717</strong> — 6.1oz garment-dyed heavyweight tee, ring-spun cotton</li>
          <li><strong>Comfort Colors 6014</strong> — garment-dyed heavyweight long-sleeve</li>
          <li><strong>Comfort Colors 1567</strong> — garment-dyed pullover hoodie</li>
          <li><strong>Comfort Colors 1566</strong> — garment-dyed crewneck sweatshirt</li>
          <li><strong>Comfort Colors 9360</strong> — garment-dyed tank</li>
          <li><strong>Comfort Colors 6030</strong> — heavyweight pocket tee</li>
          <li><strong>Comfort Colors 1469</strong> — garment-dyed fleece sweatpants</li>
          <li><strong>All-Over Print Cotton Tote</strong> — heavy cotton, sublimated full surface</li>
        </ul>
        <p style="color:var(--ink-mute); font-size:0.85rem;">
          Print method: DTG (direct-to-garment) for cotton blanks, sublimation for the tote.
          No peeling, washes-in instead of washes-out, ships in 5–7 business days from
          Printful US fulfillment centers.
        </p>

        <h4 class="contentpage__divider" id="merch-integration"><span>the integration</span></h4>
        <p>
          End-to-end: <strong>add to cart on this page → Stripe Checkout →
          Printful order auto-created on payment</strong>. The cart lives in
          your browser (localStorage), the checkout session lives on Stripe,
          the order ships from Printful. No clicks bounce off-site until you
          intentionally redirect to pay.
        </p>
        <p>
          Catalog is API-driven too:
          <code>node scripts/printful-create-products.mjs</code> deletes any
          existing FREE SATAN products, re-creates them with the design at
          <a href="/merch/design-free-satan.png">/merch/design-free-satan.png</a>,
          pulls real Printful mockups via <code>POST /v2/mockup-tasks</code>,
          and writes the manifest at <a href="/merch/suite.json">/merch/suite.json</a>.
          New design? Re-run the script; the whole catalog refreshes in ~3 minutes.
        </p>

        <h4 class="contentpage__divider" id="merch-money"><span>where the money goes</span></h4>
        <p>
          100% of profit splits two ways: <strong>60% studio operating costs</strong>
          (Cloudflare, Suno, OpenAI, mastering, distribution) and
          <strong>40% St. John’s Soup Kitchen of Newark</strong>. Studio
          financials and contribution receipts published on
          <a href="/about" data-content-page="about">/about</a>.
        </p>

        ${divider('credits')}
        <p>
          Design © Brian Zalewski / Megabyte Labs · Printful fulfillment ·
          mockups composited from Printful catalog photography · storefront at
          <a href="https://bz-music.printful.me" target="_blank" rel="noopener noreferrer">bz-music.printful.me</a>.
        </p>
       </div>
      </article>
    `,
  },

];

export const CONTENT_PAGE_BY_SLUG = new Map(CONTENT_PAGES.map(p => [p.slug, p]));
