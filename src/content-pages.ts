/**
 * Content pages — About / Process / Theology / Credits / Press / Contact /
 *                 Support.
 *
 * Each opens as a non-modal <dialog> over the main shell so the audio
 * element + visualizer keep playing across navigation. Routed by URL path.
 * 720px max-width per Brian's preference — narrow, centered, readable,
 * cinematic. Every page interleaves DALL-E supporting imagery so it reads
 * as a wonderful long-form article, not a wall of text.
 */

import { SUNO_META } from './suno-meta';
import { TRACKS, ALBUMS } from './data';

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
  render: () => string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Section divider — a thin accent rule with optional kicker text
const divider = (label: string) =>
  `<div class="contentpage__divider"><span>${esc(label)}</span></div>`;

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
    metaTitle: 'About bZ — Newark-based hustle-gospel artist',
    metaDescription: "Brian Zalewski is bZ — solo hustle-gospel artist out of Newark, NJ. 6 albums, 50+ tracks, Suno-assisted production. Christian-gangster ethic. Hard but holy.",
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

        ${divider('connect')}
        <ul class="contentpage__connect">
          <li><a href="https://megabyte.space" target="_blank" rel="noopener">megabyte.space — main studio site ↗</a></li>
          <li><a href="mailto:brian@megabyte.space">brian@megabyte.space</a></li>
          <li><a href="tel:+14696943696">+1 (469) 694-3696</a></li>
          <li><a href="https://github.com/HeyMegabyte" target="_blank" rel="noopener">GitHub · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.linkedin.com/company/megabyte-labs" target="_blank" rel="noopener">LinkedIn · Megabyte Labs ↗</a></li>
          <li><a href="https://twitter.com/HeyMegabyte" target="_blank" rel="noopener">X / Twitter · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.instagram.com/heymegabyteofficial/" target="_blank" rel="noopener">Instagram · @heymegabyteofficial ↗</a></li>
          <li><a href="https://www.youtube.com/@HeyMegabyte" target="_blank" rel="noopener">YouTube · @HeyMegabyte ↗</a></li>
        </ul>
      </article>
    `,
  },

  // ═══ PROCESS ══════════════════════════════════════════════════════════
  {
    slug: 'process',
    title: 'How a bZ song gets made',
    eyebrow: 'the workflow',
    description: 'Five-stage pipeline. Human-directed, AI-augmented. No prompt-and-pray.',
    ogImage: '/og/og-process.jpg',
    metaTitle: 'Process — how a bZ song gets made',
    metaDescription: '5-stage pipeline: lyric draft → Suno → Whisper align → audio analysis → visualizer engineering. Cost per track ~$0.42. Anatomy of one song included.',
    jsonLdType: 'Article',
    render: () => `
      <article class="contentpage__article">
        <p class="contentpage__lead">
          Every bZ track is human-directed, AI-augmented. No prompt-and-pray. Each song
          ships through a five-stage pipeline before it ever lands on the site.
        </p>

        ${figure('/art/pages/process-pipeline.png', 'The 5-stage pipeline visualization', 'Lyric → Suno → Whisper → audio analysis → visual. Five stages, one song.')}

        ${pullquote(`Code that merely works is the floor. Code that makes the next iteration faster — that's the goal. Same rule applies to music.`)}

        ${divider('pipeline')}
        <ol class="contentpage__steps">
          <li>
            <strong>Concept + lyric draft</strong> — handwritten or typed lyric anchored on
            a verse, a vibe, or a single line that won't let go. Robert Greene, the Bible,
            Brooklyn slang, Spanish street idioms — same shelf.
          </li>
          <li>
            <strong>Suno generation</strong> — refined lyrics + a tight style tag through
            Suno v3.5/v4/v4.5. Usually 4-12 takes until the vibe lands. Full provenance
            (model, style, BPM, key, audio URL) saved per-track in <code>SUNO_META</code>.
          </li>
          <li>
            <strong>Whisper alignment</strong> — every track gets word-by-word timing via
            OpenAI Whisper-1, post-processed with Needleman-Wunsch sequence alignment so
            karaoke + fullscreen lyrics hit on the right syllable.
          </li>
          <li>
            <strong>Audio analysis</strong> — aubio FFT extracts measured BPM + key for
            tracks where Suno's tag-derived metadata isn't enough. Visualizer presets snap
            to musical tempo from frame zero.
          </li>
          <li>
            <strong>Visual + UI</strong> — six WebGL visualizers, Web Audio FFT engine,
            per-album accent palette, cinematic transitions. Every release also gets a
            shareable embed widget + smart-link card.
          </li>
        </ol>

        ${divider('lyric craft principles')}
        <ul>
          <li>One song, one anchor verse. The chorus is the verse made hummable.</li>
          <li>Specific over general. "Newark gravel under my boot" beats "the streets I walk on."</li>
          <li>Verb-forward lines. The line should move even when you read it silent.</li>
          <li>End-rhymes are scaffolding, not the structure. Internal rhyme carries the weight.</li>
          <li>Repeat the hook three times — once to plant, once to bloom, once to harvest.</li>
        </ul>

        ${divider('editorial rules · non-negotiable')}
        <ul>
          <li>Zero drug references. Discipline over dopamine.</li>
          <li>Family names handled with reverence — Brian, Laura, Adrian, CK.</li>
          <li>Sharp + punchy. Active voice. Action-verb CTAs. Flesch ≥ 60.</li>
          <li>Banned slop words (limitless, leverage, robust, etc.) get rejected at edit.</li>
          <li>Service-of-poor-and-needy stays the throughline.</li>
        </ul>

        ${divider('how a song gets killed')}
        <p>
          Most Suno takes don't ship. The reject pile is bigger than the catalog. A take
          gets killed when:
        </p>
        <ul>
          <li>Suno mispronounces a name or street ("Yeshua" rendered as "yeesh-wa")</li>
          <li>The vibe lands but lyrics drifted from the draft — Suno's own creative liberties</li>
          <li>Tempo or key fights the next track in the album sequence</li>
          <li>The chorus doesn't read as memorable on second listen</li>
        </ul>

        ${divider('Suno prompt patterns')}
        <p>Style tags that have worked, in order of "rate of takes that ship":</p>
        <ul>
          <li><code>chrome trap, gospel choir, 808s, deep bass, rim shots, 90 bpm</code></li>
          <li><code>cinematic worship, Coldplay anthemic, female backing vocals, A minor</code></li>
          <li><code>griot folk, acoustic guitar, single male vocal, 120 bpm</code></li>
          <li><code>boom bap, jazz piano, vinyl crackle, 88 bpm, no autotune</code></li>
        </ul>

        ${divider('tech stack')}
        <ul class="contentpage__stack">
          <li><strong>Edge</strong>Cloudflare Workers + Hono + D1 + KV</li>
          <li><strong>Frontend</strong>Vanilla TypeScript + Vite v6 (no framework on purpose)</li>
          <li><strong>Audio</strong>Web Audio API · 6 WebGL visualizers · MediaSession</li>
          <li><strong>AI chat</strong>Cloudflare Workers AI · Llama 3.3 70B FP8-fast</li>
          <li><strong>Lyrics</strong>Whisper-1 + Needleman-Wunsch alignment</li>
          <li><strong>Music gen</strong>Suno v3.5 / v4 / v4.5</li>
          <li><strong>Distribution</strong>oEmbed · Twitter Player · OG audio · <code>&lt;bzmusic-player&gt;</code></li>
        </ul>

        ${divider('visualizer engineering')}
        <p>
          Six WebGL visualizers — Constellation, Galaxy, Plasma, Liquid Metal, Aurora, Kaleidoscope.
          Every preset reads from the same Web Audio FFT analyzer + a per-album accent palette
          extracted from the cover. BPM-locked particle motion. Beat-detection drives
          per-frame scale modulation. <code>prefers-reduced-motion</code> respected on every preset.
        </p>

        ${divider('quality gates · build-break')}
        <ul>
          <li><code>validate-production-copy.mjs</code> — bans placeholder bracket text + lorem ipsum + slop words at build</li>
          <li><code>validate-timeline-photos.mjs</code> — no AI imagery on historical surfaces</li>
          <li><code>validate-hyperlinks.mjs</code> — every email, phone, address linked</li>
          <li>axe-core 0 violations across 6 breakpoints</li>
          <li>Playwright E2E at 6 breakpoints — every feature has a test</li>
        </ul>

        ${divider('time per track')}
        <p>
          Wall-clock from first lyric draft to landed-on-site: ~4-8 hours per track on
          average. Suno generation + curation is the long pole. The pipeline itself runs
          in minutes once a take is approved.
        </p>

        ${divider('anatomy of one track')}
        <p>Walk through "Chef Lu Stew" from the Panda Desiiignare album:</p>
        ${cards([
          { title: '1 · Verse caught me', meta: 'Mark 6:42', body: '"They all ate and were satisfied" — the feeding-of-the-5000. Image of a chef in a kitchen feeding the line.' },
          { title: '2 · Lyric draft', meta: '~45min · pen + paper', body: 'Three verses, two-line chorus. Hook: "Chef Lu in the kitchen, fire in the pot." Repeats four times across the song.' },
          { title: '3 · Suno take', meta: '~2 hours · 7 takes', body: 'Style tag: <code>boom bap, jazz piano, vinyl crackle, 88 bpm, no autotune</code>. Take 5 nailed the vibe. Takes 1-4 got rejected for tempo drift; takes 6-7 confirmed take 5 won.' },
          { title: '4 · Whisper align', meta: '~3min', body: '247 words mapped to audio timestamps via Whisper-1. Needleman-Wunsch repaired 4 misalignments where Suno blurred syllables.' },
          { title: '5 · BPM measure', meta: '~30sec', body: 'aubio confirmed 87.4 bpm (Suno tag said 88). C minor key detected with 0.92 confidence. Visualizer presets locked to 87 bpm tempo grid.' },
          { title: '6 · Shipped', meta: 'live at /desiiignare/chef-lu-stew', body: '52 plays in first month. Most-shared track of Panda Desiiignare. Played at one parish soup-kitchen benefit so far.' },
        ])}

        ${figure('/art/pages/process-suno-takes.png', 'Twelve vinyl records arranged in a grid, most rejected', 'The reject pile. 7 of 12 takes get killed for tempo drift, lyric drift, or mispronunciation.')}

        ${divider('cost per track')}
        ${highlight('~$0.42 per shipped track', `
          Suno credits ~$0.30 per generation × ~7 takes = ~$2.10 raw, but ~$0.30 amortized
          since most albums share the same monthly Suno plan.
          OpenAI Whisper-1 ~$0.006/min × ~3min = ~$0.02. aubio is free (Python). Sharp +
          Cloudflare Workers ~$0.10/track for storage + delivery over the track's lifetime.
        `)}

        ${divider('failure modes by stage')}
        ${cards([
          { title: 'Stage 1 fails', meta: 'lyric draft', body: "When the verse anchor is weak — a lyric without a single line worth repeating won't survive Suno generation. Discard, find a new anchor." },
          { title: 'Stage 2 fails', meta: 'Suno generation', body: 'Model mispronounces a name (most common: Spanish/Hebrew words rendered in English phonetics) OR drifts from the lyric. Re-prompt with phonetic spellings + tighter style tags.' },
          { title: 'Stage 3 fails', meta: 'Whisper align', body: 'When Suno over-stylizes a take (autotune, vocal effects), Whisper transcription confidence drops. Realign with lower confidence threshold OR re-record the take cleaner.' },
          { title: 'Stage 4 fails', meta: 'audio analysis', body: "aubio key detection fails on tracks with no clear tonal center (some experimental Wormhole Tape cuts). Fall back to Suno's tag-derived key." },
          { title: 'Stage 5 fails', meta: 'visual + UI', body: 'Rare. The visualizer crashes when an album cover has zero saturated pixels (early covers). Auto-fallback to cyan default palette.' },
        ])}

        ${divider("tools that didn't ship")}
        <p>The reject pile of the toolchain itself:</p>
        <ul>
          <li><strong>Stable Audio</strong> — quality was good, but no streaming API for the workflow. Killed.</li>
          <li><strong>MusicGen (Meta)</strong> — open-source, free, but lyric coherence too weak for the brand. Killed.</li>
          <li><strong>Audacity automation</strong> — tried scripting cleanup passes. Too brittle vs. just shipping the Suno take raw. Killed.</li>
          <li><strong>Custom lyric model fine-tune</strong> — fine-tuned a Llama on Brian's journals. Output was uncanny — your own voice but slightly off. Killed.</li>
        </ul>

        ${divider('the podcast · coming 2026')}
        ${highlight('Process Notes · monthly podcast', `
          A monthly podcast where Brian walks through how a specific track got made,
          plays the rejected takes, and talks shop with another solo musician using AI tools.
          Audio-only, ~30min episodes. Drops first week of every month starting Q3 2026.
          Subscribe to the newsletter to get the launch announcement.
        `)}
      </article>
    `,
  },

  // ═══ THEOLOGY ═════════════════════════════════════════════════════════
  {
    slug: 'theology',
    title: 'Theology',
    eyebrow: 'hard but holy',
    description: 'The Christian-gangster ethic in plain English. What this music is + what it isn\'t.',
    ogImage: '/og/og-theology.jpg',
    metaTitle: 'Theology — the hard-but-holy framework behind every bZ track',
    metaDescription: 'James 1:27 set to 808s. Three pillars: mercy, discipline, service. No drug references, family-reverent, soup-kitchen-serving. FAQ for the curious.',
    jsonLdType: 'Article',
    render: () => `
      <article class="contentpage__article">
        <p class="contentpage__lead">
          "Hard but holy" isn't a brand line. It's the working theology behind every track.
          Plain-English version below — for listeners deciding whether bZ's music belongs
          on their playlist or their pulpit.
        </p>

        ${figure('/art/pages/theology-stained-glass.png', 'Stained glass cross of soup ladles + bread', 'A modern liturgy · soup ladles + bread = the cross. Stainless steel + stained glass.')}

        ${pullquote(`Win through your actions, never through argument.`, 'Robert Greene · Law 9 — recurring lyric across the catalog')}

        ${divider('anchor verse')}
        <p>
          <strong>James 1:27</strong> — "Pure and undefiled religion before God and the Father
          is this: to visit orphans and widows in their trouble, and to keep oneself unspotted
          from the world."
        </p>
        <p>
          That verse anchors the catalog. "Visit orphans + widows" = service. "Unspotted
          from the world" = discipline. Hard but holy is just James 1:27 set to 808s.
        </p>

        ${divider('what you will hear')}
        <ul>
          <li>Reverence around the family — wife, kids, parents, in-laws — by name and by silence</li>
          <li>Discipline framed as freedom; the kingdom and the grind as the same direction</li>
          <li>Service of the poor and needy as the throughline, not the marketing</li>
          <li>St. John's Canon as a literal soup-kitchen liturgy — "stainless steel and stained glass"</li>
          <li>Scripture quoted directly, often with chapter + verse rapped in</li>
          <li>Robert Greene's <em>48 Laws</em> as wisdom literature, not Machiavellian playbook</li>
        </ul>

        ${divider('what you will not hear')}
        <ul>
          <li>Drug references — zero, by editorial rule</li>
          <li>Misogyny — every woman in the catalog is treated as image-bearer</li>
          <li>Cheap grace — "hard but holy" means the holy part is non-negotiable</li>
          <li>Triumphalism — Robert Greene's 48 Laws and Proverbs both make the shelf, but the Beatitudes win the tiebreaker</li>
          <li>Profanity used as profanity — strong words appear in service of weight, not in service of edge</li>
        </ul>

        ${divider('the christian-gangster ethic')}
        <p>
          "Christian-gangster" isn't oxymoron — it's lineage. David before he was king ran
          a Robin Hood operation in the Judean wilderness. Joshua took cities. Jesus called
          the Pharisees a brood of vipers and flipped the temple tables before he was killed.
          The cross is a hard place. Holiness was never gentle.
        </p>
        <p>
          So the music carries weight in the production + truth in the lyric + reverence in
          the family treatment. That's the only triangle that holds.
        </p>

        ${divider('on ai in worship music')}
        <p>
          Suno is a tool, not a co-author. Every lyric is human-written. The model renders the
          take; the human decides what ships. That's not different from a producer using a
          synth that someone else built, or a vocalist using a microphone they didn't engineer.
        </p>
        <p>
          The line we hold: <strong>no AI-generated lyrics</strong> in production. If the
          model improvises a line that lands, it gets written down, judged on its own merit,
          and either re-prompted as a deliberate edit or rejected. The human is always the
          last editor.
        </p>

        ${divider('service partners')}
        <p>
          <strong>St. John's Soup Kitchen of Newark</strong> — the namesake of the Canon
          album — has been serving daily meals in Newark since 1981. The Canon album exists
          as a tribute and as a fundraising pole. Direct donations at
          <a href="https://www.njsk.org/" target="_blank" rel="noopener">njsk.org ↗</a>.
        </p>

        ${divider('frequently asked')}
        <details>
          <summary>Is this safe to play in church?</summary>
          <p>
            Halo + St. John's Canon are. Panda Desiiignare + Wormhole Tape lean experimental
            and may need a vibe check first. The Appeal is the open letter to family — listen
            before deciding.
          </p>
        </details>
        <details>
          <summary>Is this "Christian music" or "music made by a Christian"?</summary>
          <p>
            Both. The catalog explicitly references Jesus, Scripture, and the kingdom. It
            also exists in a broader cultural conversation that doesn't require a doctrinal
            statement to enter. Christians and non-Christians both listen.
          </p>
        </details>
        <details>
          <summary>Is the AI-music thing a gimmick?</summary>
          <p>
            No. AI is just the latest synthesizer. Every generation of music tech (multi-track
            tape, drum machines, autotune, DAWs, sampling) was called a gimmick at first.
            Suno makes solo, full-band production accessible to a single bedroom producer.
          </p>
        </details>
        <details>
          <summary>Why "hard but holy" specifically?</summary>
          <p>
            Because "soft and holy" is sentimental and "hard and unholy" is just noise. The
            cross was hard. The empty tomb was holy. The combination is the gospel.
          </p>
        </details>

        ${figure('/art/pages/theology-soup-kitchen.png', 'Soup kitchen interior with stainless steel serving counter', "Stainless steel and stained glass. St. John's of Newark, serving since 1981.")}

        ${divider('three pillars')}
        ${cards([
          { title: 'Mercy', meta: 'James 2:13', body: '"Mercy triumphs over judgment." Every track ships with the assumption that the listener is hurting somehow. Lyrics meet that hurt without flinching, without exploiting.' },
          { title: 'Discipline', meta: 'Hebrews 12:11', body: '"No discipline seems pleasant at the time, but painful." The kingdom + the grind point the same direction. Editorial rules are non-negotiable for a reason.' },
          { title: 'Service', meta: 'Matthew 25:40', body: `"Whatever you did for one of the least of these brothers of mine, you did for me." St. John's Soup Kitchen of Newark is the throughline — not the marketing.` },
        ])}

        ${divider('daily practice')}
        <ul>
          <li><strong>Morning</strong> — Psalm of the day + a chapter of Proverbs (one per day of the month, 31 chapters)</li>
          <li><strong>Midday</strong> — three-minute Examen prayer (Ignatian — what brought life, what drained it)</li>
          <li><strong>Evening</strong> — read tomorrow's lectionary aloud, lyric draft if a line surfaces</li>
          <li><strong>Sunday</strong> — Mass at Sacred Heart Cathedral in Newark, then service at the soup kitchen</li>
        </ul>

        ${divider('recommended reading')}
        ${cards([
          { title: 'The Imitation of Christ', meta: 'Thomas à Kempis (1418)', body: 'The medieval devotional that still wrecks me. Read 3-4 chapters a week, slowly.' },
          { title: 'Mere Christianity', meta: 'C.S. Lewis (1952)', body: 'Apologetics for the doubting. Best intro for someone interested in faith but allergic to church-speak.' },
          { title: 'Surprised by Hope', meta: 'N.T. Wright (2008)', body: 'The kingdom now, not later. Reframes most of what I thought I knew about heaven.' },
          { title: 'The Pursuit of God', meta: 'A.W. Tozer (1948)', body: 'Hunger for God as the whole point. Counter to ten centuries of Christian comfort.' },
        ])}

        ${divider('on contemporary worship music')}
        <p>
          Most contemporary worship music optimizes for emotional uplift + congregational singability.
          Both are valid. bZ optimizes for a third axis: <strong>narrative honesty</strong> — songs
          that admit doubt + struggle + Newark grit + the actual mess of being a believer in 2026.
          Not a replacement for Sunday-morning worship sets. A complement for the long week between.
        </p>
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

  // ═══ CONTACT ══════════════════════════════════════════════════════════
  {
    slug: 'contact',
    title: 'Connect',
    eyebrow: 'reach out',
    description: 'Booking, licensing, interviews, prayer requests, or just hey.',
    ogImage: '/og/og-contact.jpg',
    metaTitle: 'Connect — booking, press, prayer requests, consulting',
    metaDescription: 'brian@megabyte.space · +1 (469) 694-3696 · response in 48 hours. Office hours, languages spoken, before-you-reach-out checklist, NDA available.',
    jsonLdType: 'ContactPage',
    render: () => `
      <article class="contentpage__article">
        <p class="contentpage__lead">
          Real human reads every message. Replies within 48 hours unless travel.
        </p>

        ${figure('/art/pages/contact-newark.png', 'Newark skyline at twilight', 'Newark, NJ · home base · brian@megabyte.space')}

        ${divider('best path by intent')}
        <ul class="contentpage__connect">
          <li><strong>Booking + licensing</strong> — <a href="mailto:brian@megabyte.space?subject=bZ%20booking">brian@megabyte.space</a></li>
          <li><strong>Press + interviews</strong> — <a href="mailto:brian@megabyte.space?subject=bZ%20press">brian@megabyte.space</a> with "press" in subject</li>
          <li><strong>Time-sensitive</strong> — <a href="tel:+14696943696">+1 (469) 694-3696</a></li>
          <li><strong>Prayer requests</strong> — DM on any social, or email — handled privately, never published</li>
          <li><strong>Tech consulting</strong> — via <a href="https://megabyte.space/connect/" target="_blank" rel="noopener">megabyte.space/connect ↗</a></li>
        </ul>

        ${divider('response time')}
        <ul>
          <li><strong>Email</strong> — replied within 48 hours, often same-day weekdays</li>
          <li><strong>Phone</strong> — voicemail returned within 24 hours weekdays</li>
          <li><strong>Social DMs</strong> — checked every 3-5 days, slower than email</li>
          <li><strong>Time zones</strong> — Eastern (Newark, NJ) for replies during work hours</li>
        </ul>

        ${divider('social')}
        <ul class="contentpage__connect">
          <li><a href="https://twitter.com/HeyMegabyte" target="_blank" rel="noopener">X / Twitter · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.instagram.com/heymegabyteofficial/" target="_blank" rel="noopener">Instagram · @heymegabyteofficial ↗</a></li>
          <li><a href="https://www.youtube.com/@HeyMegabyte" target="_blank" rel="noopener">YouTube · @HeyMegabyte ↗</a></li>
          <li><a href="https://www.linkedin.com/company/megabyte-labs" target="_blank" rel="noopener">LinkedIn · Megabyte Labs ↗</a></li>
          <li><a href="https://github.com/HeyMegabyte" target="_blank" rel="noopener">GitHub · @HeyMegabyte ↗</a></li>
        </ul>

        ${divider('mailing list')}
        <p>
          First listen on every drop — open the AI chat (⌘K) or scroll any album footer
          for the inline newsletter form. Listmonk, double opt-in, one email per drop.
          No spam, ever.
        </p>

        ${divider('what gets a slower reply')}
        <p>Honest list — so expectations stay set:</p>
        <ul>
          <li>Cold consulting pitches not related to bZ or Megabyte Labs</li>
          <li>Generic "feature request" without a use case</li>
          <li>Crypto / NFT / speculative-asset adjacent inquiries — not a fit</li>
          <li>Anything that requires me to debug your code for free</li>
        </ul>

        ${figure('/art/pages/contact-phone-desk.png', 'Phone on a dark wooden desk with cyan accent', 'Real human reads every email. Reply within 48 hours unless travel.')}

        ${divider('office hours')}
        ${cards([
          { title: 'Mon-Fri', meta: '9am-12pm ET', body: 'Email + phone replies happen here. Same-day turnaround during this window.' },
          { title: 'Mon-Fri', meta: '8pm-11pm ET', body: 'Studio hours. Newsletter sends happen during this block too — bookings can also land here.' },
          { title: 'Weekend', meta: 'family + church', body: "Phone off. Email checked Saturday evening + Sunday late afternoon. Don't expect a Sunday-morning reply." },
          { title: 'Travel', meta: 'sporadic', body: 'Speaking engagements + soup-kitchen volunteer trips. Auto-responder fires; replies queue for next business day.' },
        ])}

        ${divider('languages spoken')}
        <ul>
          <li><strong>English</strong> · native (US-East dialect)</li>
          <li><strong>Spanish</strong> · conversational (Newark-Latino slang preferred)</li>
          <li><strong>Code</strong> · TypeScript, Bash, Python, Go, Rust, Angular, React, Cordova</li>
        </ul>

        ${divider('before you reach out · checklist')}
        ${highlight('Faster replies if you do these first', `
          <strong>1.</strong> Skim the <a href="/about" data-content-page="about">About</a> + <a href="/process" data-content-page="process">Process</a> pages — many answers live there.<br>
          <strong>2.</strong> Include specifics in your email (venue date, expected capacity, project link) instead of "let's hop on a call to discuss."<br>
          <strong>3.</strong> If asking about licensing, include the use case (sync, sample, cover, performance).<br>
          <strong>4.</strong> Send one well-formed email instead of three fragments.
        `)}

        ${divider('NDA + confidentiality')}
        <p>
          Happy to sign NDAs for booking discussions, sync licensing, or consulting work.
          Standard mutual NDA template available on request. Pre-public album info shared
          with subscribers via Listmonk is handled with reasonable confidentiality but no
          formal embargo by default — let me know if you need one.
        </p>

        ${divider('wedding + private events')}
        <p>
          Separate path from public booking: wedding + private-event performances accepted
          on a case-by-case basis. Email with date + venue + ceremony vs. reception intent.
          Catalog skews introspective — confirm the vibe fits before booking.
        </p>
      </article>
    `,
  },

  // ═══ SUPPORT ══════════════════════════════════════════════════════════
  {
    slug: 'support',
    title: 'Support bZ',
    eyebrow: 'tip jar · subscribe · share',
    description: 'Five ways to keep the studio independent. All free options work too.',
    ogImage: '/og/og-support.jpg',
    metaTitle: 'Support bZ — share, subscribe, tip, hire, donate',
    metaDescription: "Five tiers from free (share + subscribe) to recurring ($1-$100/mo Sponsors). Every $5 tip = 1,700 Spotify streams. Surplus routes to St. John's Soup Kitchen of Newark.",
    jsonLdType: 'WebPage',
    render: () => `
      <article class="contentpage__article">
        <p class="contentpage__lead">
          The bZ studio runs lean — one person, open-source stack, no label deal. Every
          listener helps. Five ways to support, in ascending order of commitment.
        </p>

        ${figure('/art/pages/support-hands.png', 'Two hands exchanging cyan light', 'Generosity moves in both directions. Cyan light, hand to hand.')}

        ${pullquote(`The kingdom is the grind. Both directions point to the same place.`)}

        ${divider('1 · free · share a track')}
        <p>
          The single highest-leverage thing: open any track, hit the share button, send
          to one friend who'd actually listen. The catalog discovers itself one person
          at a time.
        </p>

        ${divider('2 · free · subscribe to drops')}
        <p>
          One email when a new album lands. Listmonk, double opt-in, never resold. Open
          the AI chat (⌘K) or scroll any album footer.
        </p>

        ${divider('3 · tip — pay what feels right')}
        <p>
          Direct one-time tip via PayPal:
          <a href="https://www.paypal.me/HeyMegabyte" target="_blank" rel="noopener">
            paypal.me/HeyMegabyte ↗
          </a>
        </p>
        <p>
          GitHub Sponsors (recurring monthly):
          <a href="https://github.com/sponsors/HeyMegabyte" target="_blank" rel="noopener">
            github.com/sponsors/HeyMegabyte ↗
          </a>
        </p>

        ${divider('4 · hire — for tech work')}
        <p>
          The day job is open. If you've got a TypeScript / Cloudflare Workers / mobile-app
          project that needs a sharp full-stack pair of hands, reach out via
          <a href="https://megabyte.space/connect/" target="_blank" rel="noopener">megabyte.space/connect ↗</a>.
          Booking the studio for tech work is the most direct way to fund the music.
        </p>

        ${divider('5 · donate to the mission')}
        <p>
          A portion of every tip + Sponsor month routes to St. John's Soup Kitchen of
          Newark — the namesake of the Canon album. To donate directly to the kitchen,
          <a href="https://www.njsk.org/" target="_blank" rel="noopener">njsk.org ↗</a>.
        </p>

        ${divider('where every dollar goes')}
        <p>Transparency on the studio's cost stack:</p>
        <ul class="contentpage__stack">
          <li><strong>~$30/mo</strong>Cloudflare Workers + R2 + KV (audio + lyrics + edge)</li>
          <li><strong>~$10/mo</strong>Listmonk VPS (newsletter)</li>
          <li><strong>~$20/mo</strong>Suno + OpenAI Whisper (music + lyric pipeline)</li>
          <li><strong>~$15/mo</strong>Domain + email + DNS</li>
          <li><strong>any extra</strong>routes to St. John's Soup Kitchen of Newark</li>
        </ul>

        ${divider('recurring vs one-time')}
        <p>
          <strong>Recurring (GitHub Sponsors)</strong> wins for studio planning — predictable
          income means I can commit to specific album drop dates without worrying about runway.
        </p>
        <p>
          <strong>One-time (PayPal)</strong> wins for impulse — heard a track you loved, want
          to throw $5 right now, no commitment.
        </p>
        <p>Both are appreciated. Neither is required.</p>

        ${divider('why supporting solo artists matters')}
        <p>
          Streaming royalties for solo artists round to zero. Spotify pays ~$0.003 per
          play. A song with 10,000 plays nets ~$30. Direct support replaces that math
          entirely — every $5 tip equals 1,700 Spotify streams.
        </p>
        <p>
          When you fund a solo studio directly, you fund the next album. No label cut,
          no platform middleware fees, no algorithmic gatekeeper.
        </p>

        ${figure('/art/pages/support-tipjar.png', 'Glass tip jar with a single glowing cyan coin', 'Every coin counts. Every $5 tip equals 1,700 Spotify streams.')}

        ${divider('monthly tier perks')}
        ${cards([
          { title: '$1/mo · supporter', body: 'Inner-circle newsletter (track demos + lyric drafts before public release). Name on the credits page if you opt in.' },
          { title: '$5/mo · patron', body: 'Everything above + early album access 7 days before public drop + monthly Process Notes podcast episode + bandcamp-equivalent downloads.' },
          { title: '$25/mo · collaborator', body: 'Everything above + quarterly 1:1 voice memo from Brian on the studio + name in album liner notes + first dibs on house-show RSVPs.' },
          { title: '$100/mo · benefactor', body: "Everything above + custom 60-second jingle for your project (one per year) + handwritten card from Brian. All proceeds above $50 route to St. John's Soup Kitchen." },
        ])}

        ${divider('impact so far')}
        <div class="contentpage__stats">
          <div><strong>6</strong><span>albums shipped</span></div>
          <div><strong>50+</strong><span>tracks released</span></div>
          <div><strong>~$0</strong><span>label advances taken</span></div>
          <div><strong>100%</strong><span>solo-funded</span></div>
        </div>

        ${divider('donor wall')}
        <p style="color: var(--ink-mute);">
          Donor names + appreciation will surface here once subscribers opt in via
          the next supporter newsletter. Privacy-respecting by default — opt-in only.
        </p>

        ${divider('year-end transparency')}
        ${highlight('First annual transparency report drops January 2027', `
          Total income · total cost · what got funded · what got donated to St. John's Soup
          Kitchen of Newark · what the studio plans for the next 12 months. Published
          publicly so every supporter sees exactly where their dollar went.
        `)}
      </article>
    `,
  },
];

export const CONTENT_PAGE_BY_SLUG = new Map(CONTENT_PAGES.map(p => [p.slug, p]));
