/**
 * AI Chat — right-pane widget for music.megabyte.space.
 *
 * Cinematic chat surface — messages + composer up front, every gizmo tucked
 * into the settings drawer. Streaming SSE chat, slash registry (/help),
 * message search (⌘F), audio-reactive accent, now-playing chip, sessions
 * drawer, voice input, wake word, prompt history, drag-drop attach.
 */

import type { AudioEngine } from './audio';
import type { Track } from './types';
import { TRACKS, ALBUMS, TRACK_BY_ID, ALBUM_BY_ID, ROBERT_GREENE_WISDOM, tracksForAlbum } from './data';
import { getTrackTags } from './tags';
import { renderWidgets, parseAiWidgets, type AiChatWidget } from './ai-widgets';
import { buildShortCommandsPalette } from './ai-shortcommands';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  tokens?: number;
  liked?: 1 | -1 | 0;
  pinned?: boolean;
  parentId?: string;
  /**
   * Optional rich payload rendered below the markdown body. Built locally by
   * slash commands today; future worker streams may emit them too via a
   * fenced ```aiwidgets json``` block.
   */
  widgets?: AiChatWidget[];
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  parentId?: string;
  persona?: string;
  summary?: string;
}

type Persona = 'dj' | 'coach' | 'theologian' | 'producer' | 'friend' | 'brand' | 'historian' | 'critic';

interface Settings {
  model: string;
  temperature: number;
  maxTokens: number;
  systemOverride: string;
  pinned: string[];
  width: number;
  theme: 'cyan' | 'violet' | 'amber' | 'rose';
  density: 'compact' | 'cozy' | 'roomy';
  sendOnEnter: boolean;
  autoScroll: boolean;
  voiceRate: number;
  wakeWord: boolean;
  sfx: boolean;
  reactiveGlow: boolean;
  persona: Persona;
  theatreMode: boolean;
  spectrogramBackdrop: boolean;
  beatSyncCaret: boolean;
  adaptiveDensity: boolean;
  showReadingTime: boolean;
  pttSpacebar: boolean;
  continuousDictation: boolean;
  snippets: Record<string, string>;
  dailyRitualSeenOn: string;
  hideSpectroDuringStream: boolean;
  autoPinStars: boolean;
  collapseLongMessages: boolean;
  themeFromAlbum: boolean;
  showTokenRate: boolean;
  streakDays: number;
  streakLastOn: string;
  autoSummarizeAt: number;
}

interface Persisted {
  sessions: ChatSession[];
  activeId: string;
  settings: Settings;
  history: string[];
}

const PERSONAS: Record<Persona, { label: string; emoji: string; system: string }> = {
  dj: {
    label: 'DJ',
    emoji: '🎧',
    system:
      "You are bZ's in-app DJ — concise, warm, brand-aware. Speak in the voice of music.megabyte.space: sharp, punchy, Christian-gangster ethic, hustle-gospel, hard but holy. Reference the album Panda Desiiignare and the artist bZ when relevant. Use markdown sparingly. Default to 2-3 sentences. Never recommend or mention drugs. Stay reverent around family names (Brian, Laura, Adrian, CK)."
  },
  coach: {
    label: 'Coach',
    emoji: '🏋️',
    system:
      "You are bZ's hype coach — direct, no-fluff, accountability-driven. 2-3 sentence push. End with one concrete action. Christian-gangster ethic, hard but holy. Never mention drugs. Use family names reverently."
  },
  theologian: {
    label: 'Theologian',
    emoji: '✝️',
    system:
      "You are bZ's brother-in-Christ — wisdom-first, scripture-aware, gentle. Reference Psalms, Proverbs, and Gospel passages when fitting. Keep it grounded — Word over feels. 3-4 sentences. Family-name-reverent. No drugs ever."
  },
  producer: {
    label: 'Producer',
    emoji: '🎛️',
    system:
      "You are bZ's studio engineer — technical, opinionated, gear-aware. Speak in BPM, key, mix references. Suggest concrete production moves (sidechain, parallel comp, M/S widening). 3-4 sentences. Brand-aware but tool-first."
  },
  friend: {
    label: 'Friend',
    emoji: '🤝',
    system:
      "You are bZ's day-one friend — conversational, warm, lightly funny. Drop a smile but stay real. 2-3 sentences. No corporate hedging. Family-reverent. No drugs."
  },
  brand: {
    label: 'Brand voice',
    emoji: '⚡',
    system:
      "You are the brand voice of music.megabyte.space. Sharp. Punchy. Active voice. Servant framing. 4-8 word headlines acceptable. No banned filler ('leverage', 'seamless', 'unlock'). 2-3 sentences max."
  },
  historian: {
    label: 'Historian',
    emoji: '📜',
    system:
      "You are bZ's archivist — depth, dates, names, primary-source-aware. Cite figures inline when claimable. Connect a track to its lineage (sampling history, scene, era). 3-4 sentences. Stay accurate over flashy."
  },
  critic: {
    label: 'Critic',
    emoji: '🧪',
    system:
      "You are bZ's loyal critic — find the weak link, name it, propose the fix. No flattery. 2-4 sentences. End with one sharp improvement."
  }
};

function personaSystem(p: Persona, override: string): string {
  if (override.trim()) return override.trim();
  return PERSONAS[p]?.system || PERSONAS.dj.system;
}

const WIDGET_HINT =
  '\n\nOptional structured output: when a visual would help, append a fenced ' +
  '```aiwidgets``` block containing a JSON array of widget objects. Render markdown ' +
  'first, then the fenced block at the very end. Available kinds: track-card, ' +
  'album-card, link-card, cta, photo, gallery, pricing-card, faq-accordion, ' +
  'mini-table, comparison-table, stat-card, chart, timeline, citation, alert, ' +
  'status-badge, code-snippet, checklist, document-card, person-card, event-card, ' +
  'carousel, before-after, newsletter-signup, next-best-action, quick-reply, ' +
  'progress, search-results, breadcrumb, related-pages, command-palette, ' +
  'audio-card, text-card, feedback. Use at most three widgets per message. ' +
  'Required fields per kind are documented in docs/ai-chat-widgets.md. Never ' +
  'use widgets when the answer is a single sentence — let markdown stand alone.';

const VARIABLE_HELP = '{{track}} {{artist}} {{album}} {{lyric}} {{time}} {{bpm}} {{wisdom}}';

const STORAGE_KEY = 'bz-chat-v1';
const DEFAULT_SYSTEM = PERSONAS.dj.system;

const ROTATING_PROMPTS = [
  'Ask about a lyric.',
  'Switch the visualizer.',
  'Get a one-line prayer.',
  'Find a track for this mood.',
  'Explain the panda story.',
  'Recommend three driving tracks.',
  'Translate this verse to Spanish.',
  'Tell me what bZ would say to a hustler.'
];

interface MountOpts {
  engine?: AudioEngine | null;
  onCommand?: (cmd: string, args: string[]) => boolean | void;
}

let mounted = false;

export function mountAIChat(opts: MountOpts = {}) {
  if (mounted) return;
  mounted = true;

  const root = document.createElement('div');
  root.className = 'aichat';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'AI chat');
  root.innerHTML = `
    <button class="aichat__fab" type="button" aria-label="Open AI chat (Cmd+I)" data-aichat="fab">
      <span class="aichat__fab-dot" aria-hidden="true"></span>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-7.74 13.6L3 21l4.6-1.22A9 9 0 1 0 12 3Zm-3.5 9.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"/></svg>
    </button>
    <span class="aichat__fab-tip" data-aichat="fabTip" hidden aria-hidden="true"></span>
    <aside class="aichat__panel" data-aichat="panel" aria-hidden="true" tabindex="-1">
      <header class="aichat__head">
        <div class="aichat__title">
          <span class="aichat__title-mark" aria-hidden="true"></span>
          <strong>Ask bZ</strong>
          <span class="aichat__status" data-aichat="status">Ready</span>
          <span class="aichat__rms" data-aichat="rms" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </span>
          <span class="aichat__streak" data-aichat="streak" hidden aria-label="Daily streak">
            <span data-aichat="streakNum">0</span>d
          </span>
        </div>
        <div class="aichat__head-actions">
          <button type="button" class="aichat__icon" data-aichat="search" aria-label="Search messages" title="Search (⌘F)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 1-5 14.3l-3.3 3.3-1.4-1.4 3.3-3.3A8 8 0 0 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
          </button>
          <button type="button" class="aichat__icon" data-aichat="sessions" aria-label="Conversations" title="Conversations">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Z"/></svg>
          </button>
          <button type="button" class="aichat__icon" data-aichat="new" aria-label="New conversation" title="New (⌘N)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z"/></svg>
          </button>
          <button type="button" class="aichat__icon" data-aichat="settings" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>
          </button>
          <button type="button" class="aichat__icon" data-aichat="close" aria-label="Close" title="Close (Esc)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3 10.6 10.6 16.9 4.3l1.4 1.4Z"/></svg>
          </button>
        </div>
      </header>

      <canvas class="aichat__spectro" data-aichat="spectro" aria-hidden="true"></canvas>

      <button type="button" class="aichat__now" data-aichat="now" hidden aria-label="Now playing — ask about this track">
        <span class="aichat__now-cover" data-aichat="nowCover" aria-hidden="true">
          <span class="aichat__now-cover-initial" data-aichat="nowInitial">b</span>
          <span class="aichat__now-cover-bars" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </span>
        </span>
        <span class="aichat__now-text">
          <span class="aichat__now-title" data-aichat="nowTitle"></span>
          <span class="aichat__now-meta" data-aichat="nowMeta"></span>
          <span class="aichat__now-chips" data-aichat="nowChips" aria-hidden="true"></span>
        </span>
        <span class="aichat__now-pulse" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>

      <div class="aichat__pins" data-aichat="pinsStrip" hidden role="toolbar" aria-label="Pinned memory"></div>

      <div class="aichat__ritual" data-aichat="ritual" hidden role="status"></div>

      <div class="aichat__msearch" data-aichat="msearch" hidden>
        <input type="search" data-aichat="msearchInput" placeholder="Search messages" aria-label="Search messages" />
        <span class="aichat__msearch-count" data-aichat="msearchCount">0</span>
        <button type="button" data-aichat="msearchPrev" aria-label="Previous match">↑</button>
        <button type="button" data-aichat="msearchNext" aria-label="Next match">↓</button>
        <button type="button" data-aichat="msearchClose" aria-label="Close search">✕</button>
      </div>

      <div class="aichat__body" data-aichat="body">
        <div class="aichat__welcome" data-aichat="welcome">
          <h3>Ask bZ anything.</h3>
          <p class="aichat__welcome-sub">Tracks, lyrics, gear, prayer, anything. Hard but holy.</p>
          <div class="aichat__welcome-rotating" data-aichat="welcomeRotating" aria-live="polite"></div>
          <div class="aichat__chips" data-aichat="chips">
            <button type="button" data-prompt="What's playing right now?">What's playing?</button>
            <button type="button" data-prompt="Explain the meaning of this song's lyrics.">Explain these lyrics</button>
            <button type="button" data-prompt="Recommend three bZ tracks for late-night driving.">Late-night picks</button>
            <button type="button" data-prompt="Tell me the story behind the album Panda Desiiignare.">Album story</button>
            <button type="button" data-prompt="Switch the visualizer to plasma and tell me why it's beautiful.">Switch viz → plasma</button>
            <button type="button" data-prompt="Write a one-line prayer for a hustler grinding through Sunday.">One-line prayer</button>
          </div>
        </div>

        <ol class="aichat__messages" data-aichat="messages" aria-live="polite" aria-busy="false"></ol>

        <button type="button" class="aichat__scroll-btm" data-aichat="scrollBtm" hidden aria-label="Scroll to bottom">↓ New</button>
      </div>

      <aside class="aichat__drawer aichat__drawer--sessions" data-aichat="sidebar" aria-label="Conversations">
        <div class="aichat__drawer-head">
          <span class="aichat__drawer-title">Conversations</span>
          <span class="aichat__sidebar-count" data-aichat="sessionCount" aria-live="polite">0</span>
          <button type="button" class="aichat__icon" data-aichat="sidebarClose" aria-label="Close conversations">✕</button>
        </div>
        <div class="aichat__drawer-body aichat__drawer-body--sessions">
          <div class="aichat__sidebar-search">
            <svg class="aichat__sidebar-search-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" data-aichat="searchSessions" placeholder="Search conversations" aria-label="Search conversations" />
            <button type="button" class="aichat__sidebar-search-clear" data-aichat="searchSessionsClear" aria-label="Clear search" hidden>✕</button>
          </div>
          <ul class="aichat__sidebar-list" data-aichat="sessionList" role="list"></ul>
          <p class="aichat__sidebar-empty" data-aichat="sessionEmpty" hidden>No matches. Start a new conversation with ⌘N.</p>
        </div>
      </aside>

      <aside class="aichat__drawer aichat__drawer--settings" data-aichat="settingsPanel" aria-label="Settings">
        <div class="aichat__drawer-head">
          <span class="aichat__drawer-title">Settings</span>
          <button type="button" class="aichat__icon" data-aichat="settingsClose" aria-label="Close settings">✕</button>
        </div>
        <div class="aichat__drawer-body">
          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Look</span>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Accent</span>
              <div class="aichat__swatch" data-aichat="themeSwatch" role="radiogroup" aria-label="Accent color">
                <button type="button" data-theme="cyan"   style="--c:#00E5FF" aria-label="Cyan"></button>
                <button type="button" data-theme="violet" style="--c:#b78aff" aria-label="Violet"></button>
                <button type="button" data-theme="amber"  style="--c:#ffb347" aria-label="Amber"></button>
                <button type="button" data-theme="rose"   style="--c:#ff7a9c" aria-label="Rose"></button>
              </div>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Density</span>
              <div class="aichat__seg" data-aichat="densitySeg" role="radiogroup" aria-label="Density">
                <button type="button" data-density="compact">Compact</button>
                <button type="button" data-density="cozy">Cozy</button>
                <button type="button" data-density="roomy">Roomy</button>
              </div>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Reactive glow</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="reactiveGlow" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Persona</span>
            <label class="aichat__field">
              <span class="aichat__field-label">Voice</span>
              <select data-aichat="persona">
                ${Object.entries(PERSONAS)
                  .map(([k, p]) => `<option value="${k}">${p.emoji} ${p.label}</option>`)
                  .join('')}
              </select>
            </label>
            <p class="aichat__hint-note">Override the voice anytime with the System prompt below.</p>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Model</span>
            <label class="aichat__field">
              <span class="aichat__field-label">Model</span>
              <select data-aichat="model">
                <option value="claude-haiku-4-5-20251001">Haiku 4.5 — fastest</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6 — balanced</option>
                <option value="claude-opus-4-7">Opus 4.7 — deepest</option>
              </select>
            </label>
            <label class="aichat__field">
              <span class="aichat__field-label">Temperature <em data-aichat="tempVal">0.70</em></span>
              <input type="range" min="0" max="1" step="0.05" value="0.7" data-aichat="temp" />
            </label>
            <label class="aichat__field">
              <span class="aichat__field-label">Max tokens <em data-aichat="maxTokVal">1024</em></span>
              <input type="range" min="128" max="4096" step="64" value="1024" data-aichat="maxTok" />
            </label>
            <label class="aichat__field">
              <span class="aichat__field-label">System prompt</span>
              <textarea data-aichat="system" rows="4" placeholder="Override the brand voice (blank = default)"></textarea>
            </label>
            <button type="button" class="aichat__btn aichat__btn--ghost" data-aichat="resetSystem">Reset system prompt</button>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Composer</span>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Send on Enter</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="sendOnEnter" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Auto-scroll</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="autoScroll" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Voice</span>
            <label class="aichat__field">
              <span class="aichat__field-label">Read-aloud rate <em data-aichat="voiceRateVal">1.05</em></span>
              <input type="range" min="0.6" max="1.6" step="0.05" value="1.05" data-aichat="voiceRate" />
            </label>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Wake word "hey bz"</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="wakeWord" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">SFX</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="sfx" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Stage</span>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Theatre mode</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="theatreMode" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Spectrogram backdrop</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="spectrogramBackdrop" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Hide spectro during stream</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="hideSpectroDuringStream" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Beat-sync caret</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="beatSyncCaret" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Adaptive density</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="adaptiveDensity" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Reading-time</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="showReadingTime" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Collapse long replies</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="collapseLongMessages" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Show token rate</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="showTokenRate" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Auto-pin liked (★)</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="autoPinStars" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Theme from album</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="themeFromAlbum" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Hold-space dictation</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="pttSpacebar" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <div class="aichat__field aichat__field--row">
              <span class="aichat__field-label">Continuous dictation</span>
              <label class="aichat__toggle"><input type="checkbox" data-aichat="continuousDictation" /><span class="aichat__toggle-track"></span><span class="aichat__toggle-thumb"></span></label>
            </div>
            <label class="aichat__field">
              <span class="aichat__field-label">Auto-summarize after <em data-aichat="autoSummarizeAtVal">22</em> msgs</span>
              <input type="range" min="10" max="60" step="2" value="22" data-aichat="autoSummarizeAt" />
            </label>
          </section>

          <section class="aichat__drawer-section">
            <span class="aichat__drawer-section-title">Data</span>
            <button type="button" class="aichat__btn aichat__btn--ghost" data-aichat="notify">Enable notifications</button>
            <button type="button" class="aichat__btn aichat__btn--ghost" data-aichat="poster">Save conversation poster</button>
            <button type="button" class="aichat__btn aichat__btn--ghost" data-aichat="cheatsheet">Keyboard cheat sheet</button>
            <button type="button" class="aichat__btn aichat__btn--ghost" data-aichat="exportAll">Export all chats</button>
            <button type="button" class="aichat__btn aichat__btn--danger" data-aichat="clearAll">Clear all chat data</button>
          </section>
        </div>
      </aside>

      <div class="aichat__sheet" data-aichat="sheetBackdrop" hidden></div>
      <dialog class="aichat__cheatsheet" data-aichat="cheatBox" aria-label="Keyboard shortcuts">
        <h3>Keyboard shortcuts</h3>
        <ul>
          <li><kbd>⌘ I</kbd>Toggle chat</li>
          <li><kbd>⌘ N</kbd>New conversation</li>
          <li><kbd>⌘ F</kbd>Search messages</li>
          <li><kbd>⌘ /</kbd>Slash help</li>
          <li><kbd>⌘ ,</kbd>Settings</li>
          <li><kbd>⌘ E</kbd>Export markdown</li>
          <li><kbd>⌘ L</kbd>Clear chat</li>
          <li><kbd>⌘ ⇧ Enter</kbd>Theatre mode</li>
          <li><kbd>/</kbd>Slash commands</li>
          <li><kbd>?</kbd>This card</li>
          <li><kbd>Space (hold)</kbd>Push-to-talk</li>
          <li><kbd>Esc</kbd>Close overlays</li>
        </ul>
        <button type="button" class="aichat__btn" data-aichat="cheatClose">Got it</button>
      </dialog>

      <div class="aichat__urlhint" data-aichat="urlhint" hidden role="status"></div>
      <div class="aichat__continue" data-aichat="continueBanner" hidden role="status">
        <span>Reply hit the cap.</span>
        <button type="button" data-aichat="continueGo">Continue →</button>
        <button type="button" class="aichat__icon" data-aichat="continueClose" aria-label="Dismiss">✕</button>
      </div>
      <div class="aichat__snipbar" data-aichat="snipbar" hidden role="toolbar" aria-label="Snippets"></div>
      <div class="aichat__quickbar" data-aichat="quickbar" role="toolbar" aria-label="Quick commands">
        <button type="button" data-quick="/today">⛅ Today</button>
        <button type="button" data-quick="/lyric">🎤 Lyric</button>
        <button type="button" data-quick="/mood ">🌙 Mood</button>
        <button type="button" data-quick="/setlist 6">🎚️ Setlist</button>
        <button type="button" data-quick="/critique">🧪 Critique</button>
        <button type="button" data-quick="/why">⚡ Why this hits</button>
      </div>

      <form class="aichat__composer" data-aichat="composer" novalidate>
        <div class="aichat__mention" data-aichat="mention" hidden role="listbox" aria-label="Track mentions"></div>
        <div class="aichat__attach" data-aichat="attachments" hidden></div>
        <div class="aichat__rate" data-aichat="rate" hidden aria-hidden="true"></div>
        <div class="aichat__row">
          <button type="button" class="aichat__icon aichat__voice" data-aichat="voice" aria-label="Voice input" title="Voice">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm7 10a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12h-2Z"/></svg>
          </button>
          <label class="aichat__sr"><span>Message</span>
            <textarea
              data-aichat="input"
              placeholder="Message bZ — try /help"
              rows="1"
              autocomplete="off"
              autocorrect="on"
              autocapitalize="sentences"
              spellcheck="true"
            ></textarea>
          </label>
          <button type="submit" class="aichat__send" data-aichat="send" disabled aria-label="Send (Enter)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M2.5 21 23 12 2.5 3 2 10l15 2-15 2 .5 7Z"/></svg>
          </button>
        </div>
        <div class="aichat__meter" data-aichat="meter">
          <span data-aichat="hint">Enter to send · Shift+Enter newline · / for commands</span>
          <span data-aichat="counter">0</span>
        </div>
      </form>

      <div class="aichat__resize" data-aichat="resize" aria-hidden="true"></div>
    </aside>
  `;
  document.body.appendChild(root);

  const $ = <T = HTMLElement>(sel: string) => root.querySelector(`[data-aichat="${sel}"]`) as unknown as T;

  const panel = $('panel');
  const fab = $('fab');
  const status = $('status');
  const messages = $<HTMLOListElement>('messages');
  const composer = $<HTMLFormElement>('composer');
  const input = $<HTMLTextAreaElement>('input');
  const sendBtn = $<HTMLButtonElement>('send');
  const welcome = $('welcome');
  const welcomeRotating = $('welcomeRotating');
  const sidebar = $('sidebar');
  const settingsPanel = $('settingsPanel');
  const sessionList = $<HTMLUListElement>('sessionList');
  const scrollBtm = $<HTMLButtonElement>('scrollBtm');
  const counter = $('counter');
  const meter = $('meter');
  const tempSlider = $<HTMLInputElement>('temp');
  const tempVal = $('tempVal');
  const maxTokSlider = $<HTMLInputElement>('maxTok');
  const maxTokVal = $('maxTokVal');
  const modelSelect = $<HTMLSelectElement>('model');
  const systemArea = $<HTMLTextAreaElement>('system');
  const searchSessions = $<HTMLInputElement>('searchSessions');
  const searchSessionsClear = $<HTMLButtonElement>('searchSessionsClear');
  const sessionCount = $('sessionCount');
  const sessionEmpty = $('sessionEmpty');
  const resize = $('resize');
  const now = $<HTMLButtonElement>('now');
  const nowTitle = $('nowTitle');
  const nowMeta = $('nowMeta');
  const nowCover = $('nowCover');
  const nowInitial = $('nowInitial');
  const nowChips = $('nowChips');
  const msearch = $('msearch');
  const msearchInput = $<HTMLInputElement>('msearchInput');
  const msearchCount = $('msearchCount');
  const attachments = $('attachments');
  const spectro = $<HTMLCanvasElement>('spectro');
  const pinsStrip = $('pinsStrip');
  const ritual = $('ritual');
  const mention = $('mention');
  const cheatBox = $<HTMLDialogElement>('cheatBox');
  const sheetBackdrop = $('sheetBackdrop');
  const personaSel = $<HTMLSelectElement>('persona');
  const streakBadge = $('streak');
  const streakNum = $('streakNum');
  const quickbar = $('quickbar');
  const snipbar = $('snipbar');
  const urlhint = $('urlhint');
  const continueBanner = $('continueBanner');
  const rateBox = $('rate');
  const fabTip = $('fabTip');

  let state: Persisted = loadState();
  let abortCtrl: AbortController | null = null;
  let autoScrollLocked = false;
  let voiceRec: { stop: () => void } | null = null;
  let historyIdx = -1;
  let historyDraft = '';
  let msearchMatches: HTMLElement[] = [];
  let msearchIdx = 0;
  let attachedFiles: File[] = [];
  let mentionList: Track[] = [];
  let mentionIdx = 0;
  let mentionAnchor = -1;

  function loadState(): Persisted {
    const defaults: Settings = {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 1024,
      systemOverride: '',
      pinned: [],
      width: 460,
      theme: 'cyan',
      density: 'cozy',
      sendOnEnter: true,
      autoScroll: true,
      voiceRate: 1.05,
      wakeWord: false,
      sfx: false,
      reactiveGlow: true,
      persona: 'dj',
      theatreMode: false,
      spectrogramBackdrop: true,
      beatSyncCaret: true,
      adaptiveDensity: true,
      showReadingTime: true,
      pttSpacebar: false,
      continuousDictation: false,
      snippets: {},
      dailyRitualSeenOn: '',
      hideSpectroDuringStream: false,
      autoPinStars: true,
      collapseLongMessages: true,
      themeFromAlbum: false,
      showTokenRate: true,
      streakDays: 0,
      streakLastOn: '',
      autoSummarizeAt: 22
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        if (p?.sessions?.length && p.activeId) {
          return {
            sessions: p.sessions,
            activeId: p.activeId,
            settings: { ...defaults, ...(p.settings || {}) } as Settings,
            history: p.history?.slice(-50) || []
          };
        }
      }
    } catch {}
    const seed: Persisted = {
      sessions: [makeSession()],
      activeId: '',
      settings: defaults,
      history: []
    };
    seed.activeId = seed.sessions[0].id;
    return seed;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function makeSession(): ChatSession {
    return { id: cryptoId(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  }

  function cryptoId(): string {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function activeSession(): ChatSession {
    return state.sessions.find(s => s.id === state.activeId) || state.sessions[0];
  }

  function setOpen(open: boolean) {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    fab.classList.toggle('is-hidden', open);
    document.body.classList.toggle('has-aichat-open', open);
    if (open) {
      input.focus();
      maybeShowRitual();
      try {
        window.dispatchEvent(new CustomEvent('aichat:open'));
      } catch {}
    }
  }

  function applySettings() {
    const s = state.settings;
    tempSlider.value = String(s.temperature);
    tempVal.textContent = s.temperature.toFixed(2);
    maxTokSlider.value = String(s.maxTokens);
    maxTokVal.textContent = String(s.maxTokens);
    modelSelect.value = s.model;
    systemArea.value = s.systemOverride;
    if (s.width) panel.style.setProperty('--aichat-w', `${s.width}px`);
    root.setAttribute('data-theme', s.theme);
    root.setAttribute('data-density', s.density);
    root.classList.toggle('is-reactive', s.reactiveGlow);
    ($('sendOnEnter') as HTMLInputElement).checked = s.sendOnEnter;
    ($('autoScroll') as HTMLInputElement).checked = s.autoScroll;
    ($('wakeWord') as HTMLInputElement).checked = s.wakeWord;
    ($('sfx') as HTMLInputElement).checked = s.sfx;
    ($('reactiveGlow') as HTMLInputElement).checked = s.reactiveGlow;
    const vr = $<HTMLInputElement>('voiceRate');
    vr.value = String(s.voiceRate);
    $('voiceRateVal').textContent = s.voiceRate.toFixed(2);
    root
      .querySelectorAll<HTMLButtonElement>('[data-aichat="themeSwatch"] button')
      .forEach(b => b.classList.toggle('is-active', b.dataset.theme === s.theme));
    root
      .querySelectorAll<HTMLButtonElement>('[data-aichat="densitySeg"] button')
      .forEach(b => b.classList.toggle('is-active', b.dataset.density === s.density));
    personaSel.value = s.persona;
    root.setAttribute('data-persona', s.persona);
    root.classList.toggle('is-theatre', s.theatreMode);
    root.classList.toggle('has-spectro', s.spectrogramBackdrop);
    root.classList.toggle('is-beatsync', s.beatSyncCaret);
    root.classList.toggle('is-readtime', s.showReadingTime);
    ($('theatreMode') as HTMLInputElement).checked = s.theatreMode;
    ($('spectrogramBackdrop') as HTMLInputElement).checked = s.spectrogramBackdrop;
    ($('beatSyncCaret') as HTMLInputElement).checked = s.beatSyncCaret;
    ($('adaptiveDensity') as HTMLInputElement).checked = s.adaptiveDensity;
    ($('showReadingTime') as HTMLInputElement).checked = s.showReadingTime;
    ($('pttSpacebar') as HTMLInputElement).checked = s.pttSpacebar;
    ($('continuousDictation') as HTMLInputElement).checked = s.continuousDictation;
    ($('hideSpectroDuringStream') as HTMLInputElement).checked = s.hideSpectroDuringStream;
    ($('collapseLongMessages') as HTMLInputElement).checked = s.collapseLongMessages;
    ($('showTokenRate') as HTMLInputElement).checked = s.showTokenRate;
    ($('autoPinStars') as HTMLInputElement).checked = s.autoPinStars;
    ($('themeFromAlbum') as HTMLInputElement).checked = s.themeFromAlbum;
    const autoSumSlider = $<HTMLInputElement>('autoSummarizeAt');
    autoSumSlider.value = String(s.autoSummarizeAt);
    $('autoSummarizeAtVal').textContent = String(s.autoSummarizeAt);
    root.classList.toggle('is-collapse-long', s.collapseLongMessages);
    root.classList.toggle('is-hide-spectro-stream', s.hideSpectroDuringStream);
    root.classList.toggle('is-show-rate', s.showTokenRate);
    if (s.streakDays > 1 && streakBadge) {
      streakBadge.hidden = false;
      streakNum.textContent = String(s.streakDays);
    } else if (streakBadge) {
      streakBadge.hidden = true;
    }
  }

  function renderSessions(filter = '') {
    const q = filter.trim().toLowerCase();
    const total = state.sessions.length;
    const items = state.sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(
        s =>
          !q || s.title.toLowerCase().includes(q) || s.messages.some(m => m.content.toLowerCase().includes(q))
      );
    sessionCount.textContent = q ? `${items.length}/${total}` : String(total);
    if (searchSessionsClear) searchSessionsClear.toggleAttribute('hidden', !q);
    if (sessionEmpty) sessionEmpty.toggleAttribute('hidden', items.length > 0);
    sessionList.innerHTML = items
      .map(s => {
        const active = s.id === state.activeId ? 'is-active' : '';
        const last = s.messages[s.messages.length - 1];
        const preview = (last?.content || 'No messages yet').replace(/\s+/g, ' ').slice(0, 64);
        const stamp = relTime(s.updatedAt);
        const count = s.messages.length;
        const role = last?.role === 'assistant' ? '◆' : last?.role === 'user' ? '▸' : '·';
        const title = highlightMatch(s.title, q);
        const previewHtml = highlightMatch(preview, q);
        return `<li><button type="button" class="aichat__session ${active}" data-id="${s.id}">
            <span class="aichat__session-row">
              <span class="aichat__session-title">${title}</span>
              <span class="aichat__session-stamp">${stamp}</span>
            </span>
            <span class="aichat__session-preview"><span class="aichat__session-role" aria-hidden="true">${role}</span>${previewHtml}</span>
            <span class="aichat__session-meta">${count} ${count === 1 ? 'msg' : 'msgs'}</span>
          </button>
          <button type="button" class="aichat__icon aichat__session-del" data-del="${s.id}" aria-label="Delete conversation">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3v1H4v2h1l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14h1V4h-5V3H9Zm2 5h2v10h-2V8Z"/></svg>
          </button></li>`;
      })
      .join('');
    sessionList.scrollTop = 0;
  }

  function relTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function highlightMatch(text: string, q: string): string {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q);
    if (i < 0) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  }

  function autoTitle(content: string): string {
    const first = content.split(/[\n.?!]/)[0].trim();
    return first.length > 48 ? first.slice(0, 45) + '…' : first || 'New chat';
  }

  function renderMessages() {
    const sess = activeSession();
    welcome.toggleAttribute('hidden', sess.messages.length > 0);
    messages.toggleAttribute('hidden', sess.messages.length === 0);
    messages.innerHTML = sess.messages.map(m => renderMessage(m)).join('');
    if (state.settings.adaptiveDensity) {
      const eff =
        sess.messages.length > 16 ? 'compact' : sess.messages.length > 6 ? 'cozy' : state.settings.density;
      root.setAttribute('data-density', eff);
    }
    renderPins();
    if (state.settings.autoScroll && !autoScrollLocked) requestAnimationFrame(() => scrollToBottom());
  }

  function renderPins() {
    const sess = activeSession();
    const chips: string[] = [];
    state.settings.pinned.forEach((p, i) => {
      chips.push(
        `<button type="button" class="aichat__pin-chip" data-pin-global="${i}" title="${escapeHtml(p)}">📌 ${escapeHtml(p.slice(0, 28))}${p.length > 28 ? '…' : ''}</button>`
      );
    });
    sess.messages
      .filter(m => m.pinned)
      .forEach(m => {
        const snippet = m.content.slice(0, 28);
        chips.push(
          `<button type="button" class="aichat__pin-chip" data-pin-msg="${m.id}" title="${escapeHtml(m.content.slice(0, 200))}">📍 ${escapeHtml(snippet)}${m.content.length > 28 ? '…' : ''}</button>`
        );
      });
    if (!chips.length) {
      pinsStrip.hidden = true;
      pinsStrip.innerHTML = '';
      return;
    }
    pinsStrip.hidden = false;
    pinsStrip.innerHTML = chips.join('');
  }

  function renderMessage(m: ChatMessage): string {
    const cls = m.role === 'user' ? 'aichat__msg aichat__msg--user' : 'aichat__msg aichat__msg--ai';
    const pinned = m.pinned ? ' is-pinned' : '';
    const isLong = state.settings.collapseLongMessages && m.content.length > 1200;
    const wrapCollapsed = isLong ? ' is-collapsed' : '';
    const bodyCollapsed = isLong ? ' is-collapsed' : '';
    const personaAttr = m.role === 'assistant' ? ` data-persona="${state.settings.persona}"` : '';
    const ts = formatTime(m.ts);
    const body = m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content);
    const readTime =
      state.settings.showReadingTime && m.content.length > 80
        ? `<span class="aichat__readtime" title="Estimated read">${readingTime(m.content)}</span>`
        : '';
    const expandBtn = isLong
      ? `<button type="button" class="aichat__msg-expand" data-act="expand" data-id="${m.id}">Show all ${m.content.length.toLocaleString()} chars ▾</button>`
      : '';
    const widgetsHtml = m.role === 'assistant' ? renderWidgets(m.widgets) : '';
    return `<li class="${cls}${pinned}${wrapCollapsed}" data-id="${m.id}" id="msg-${m.id}"${personaAttr}>
      <div class="aichat__msg-meta"><span>${m.role === 'user' ? 'You' : 'bZ'}</span><time>${ts}</time>${readTime}</div>
      <div class="aichat__msg-body${bodyCollapsed}">${body}</div>
      ${widgetsHtml}
      ${expandBtn}
      <div class="aichat__msg-tools" role="toolbar" aria-label="Message actions">
        <button type="button" data-act="copy" data-id="${m.id}" aria-label="Copy" title="Copy">⧉</button>
        ${m.role === 'assistant' ? `<button type="button" data-act="speak" data-id="${m.id}" aria-label="Read aloud" title="Read aloud">🔊</button>` : ''}
        ${m.role === 'user' ? `<button type="button" data-act="edit" data-id="${m.id}" aria-label="Edit" title="Edit">✎</button>` : ''}
        ${m.role === 'assistant' ? `<button type="button" data-act="retry" data-id="${m.id}" aria-label="Regenerate" title="Regenerate">↺</button>` : ''}
        ${m.role === 'assistant' ? `<button type="button" data-act="critique" data-id="${m.id}" aria-label="Critique" title="Self-critique pass">🧪</button>` : ''}
        ${m.role === 'assistant' ? `<button type="button" data-act="rewrite" data-id="${m.id}" aria-label="Rewrite tighter" title="Rewrite tighter">✂︎</button>` : ''}
        ${m.role === 'assistant' ? `<button type="button" data-act="branch" data-id="${m.id}" aria-label="Branch" title="Branch conversation">⎇</button>` : ''}
        <button type="button" data-act="pin" data-id="${m.id}" aria-pressed="${m.pinned ? 'true' : 'false'}" aria-label="Pin" title="Pin">${m.pinned ? '📌' : '📍'}</button>
        ${m.role === 'assistant' ? `<button type="button" data-act="like" data-id="${m.id}" aria-pressed="${m.liked === 1}" aria-label="Like" title="Like">${m.liked === 1 ? '♥' : '♡'}</button>` : ''}
      </div>
    </li>`;
  }

  function readingTime(text: string): string {
    const words = text.trim().split(/\s+/).length;
    const sec = Math.max(1, Math.round((words / 220) * 60));
    if (sec < 60) return `${sec}s read`;
    const m = Math.round(sec / 60);
    return `${m} min read`;
  }

  function renderMarkdown(src: string): string {
    const tokens: string[] = [];
    const tok = (html: string) => {
      tokens.push(html);
      return ` ${tokens.length - 1} `;
    };
    let s = src.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) =>
      tok(
        `<pre class="aichat__code" data-lang="${escapeHtml(lang)}"><button class="aichat__copycode" type="button" data-copycode>Copy</button><code>${escapeHtml(code)}</code></pre>`
      )
    );
    s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => tok(`<code>${escapeHtml(c)}</code>`));
    s = escapeHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    s = s.replace(
      /(^|\s)(https?:\/\/[^\s<]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
    );
    s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>.+<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    s = s.replace(/ (\d+) /g, (_m, i: string) => tokens[Number(i)] || '');
    return `<p>${s}</p>`;
  }

  function escapeHtml(s: string): string {
    return s.replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
    );
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
    scrollBtm.hidden = true;
    autoScrollLocked = false;
  }

  function setStatus(text: string, busy = false) {
    status.textContent = text;
    messages.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function trackContext(): string {
    const eng = opts.engine;
    const st = eng?.state();
    if (!st?.track) return 'No track is currently playing.';
    const cur = st.track;
    const min = Math.floor((st.currentTime || 0) / 60);
    const sec = Math.floor((st.currentTime || 0) % 60)
      .toString()
      .padStart(2, '0');
    const bpm = st.bpm > 30 ? `, ~${Math.round(st.bpm)} BPM` : '';
    const lyric = currentLyric();
    const lyricLine = lyric ? `\nCurrent lyric line: "${lyric}".` : '';
    const wisdom = cur.wisdom ? `\nTrack wisdom: ${cur.wisdom}` : '';
    return `Now playing: "${cur.title}" by ${cur.artist || 'bZ'}${cur.album ? ` (${cur.album})` : ''} at ${min}:${sec}${bpm}. Status: ${st.playing ? 'playing' : 'paused'}.${lyricLine}${wisdom}`;
  }

  function currentLyric(): string {
    const st = opts.engine?.state();
    if (!st?.track?.lyrics?.length) return '';
    const dur = st.duration || 0;
    if (!dur) return st.track.lyrics[0] || '';
    const idx = Math.min(
      st.track.lyrics.length - 1,
      Math.floor((st.currentTime / dur) * st.track.lyrics.length)
    );
    return st.track.lyrics[idx] || '';
  }

  function expandVariables(text: string): string {
    if (!/\{\{[a-z]+\}\}/i.test(text)) return text;
    const st = opts.engine?.state();
    const cur = st?.track;
    const min = Math.floor((st?.currentTime || 0) / 60);
    const sec = Math.floor((st?.currentTime || 0) % 60)
      .toString()
      .padStart(2, '0');
    const vars: Record<string, string> = {
      track: cur?.title || 'no track',
      artist: cur?.artist || 'bZ',
      album: cur?.album || 'no album',
      lyric: currentLyric() || 'no lyric',
      time: `${min}:${sec}`,
      bpm: st?.bpm ? Math.round(st.bpm).toString() : '—',
      wisdom:
        cur?.wisdom || ROBERT_GREENE_WISDOM[Math.floor(Math.random() * ROBERT_GREENE_WISDOM.length)] || ''
    };
    return text.replace(/\{\{([a-z]+)\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? `{{${k}}}`);
  }

  async function maybeAutoSummarize(sess: ChatSession) {
    const threshold = Math.max(10, state.settings.autoSummarizeAt || 22);
    if (sess.messages.length < threshold) return;
    const keep = Math.max(8, Math.floor(threshold * 0.64));
    const oldest = sess.messages.slice(0, sess.messages.length - keep);
    if (oldest.length < 6) return;
    const lines = oldest.map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content.slice(0, 240)}`).join('\n');
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Summarize this prior chat into 3-5 dense bullet points capturing facts, requests, and decisions. Keep names, song titles, BPM hits.\n\n${lines}`
            }
          ],
          system: 'You are a precise summarizer. No filler. Bullet points only.',
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.2,
          max_tokens: 320,
          stream: false
        })
      });
      const j = await res.json().catch(() => null);
      const txt =
        (j as { content?: string; text?: string } | null)?.content ||
        (j as { content?: { text?: string }[] } | null)?.content?.[0]?.text ||
        '';
      if (typeof txt === 'string' && txt.trim()) {
        sess.summary = (sess.summary ? sess.summary + '\n' : '') + txt.trim();
        sess.messages = sess.messages.slice(-keep);
        saveState();
        renderMessages();
        setStatus('Older turns summarized');
      }
    } catch {}
  }

  async function send(userText: string) {
    const trimmed = userText.trim();
    if (!trimmed || abortCtrl) return;

    if (trimmed.includes(' && ') && /^\/|.* && \//.test(trimmed)) {
      const segments = trimmed
        .split(/ && /)
        .map(s => s.trim())
        .filter(Boolean);
      input.value = '';
      updateInputUI();
      for (const seg of segments) {
        if (seg.startsWith('/')) {
          handleSlash(seg);
        } else {
          await send(seg);
          if (!abortCtrl) await new Promise(r => setTimeout(r, 60));
        }
      }
      return;
    }

    if (trimmed.startsWith('/')) {
      const handled = handleSlash(trimmed);
      if (handled) {
        input.value = '';
        updateInputUI();
        return;
      }
    }
    state.history = [...state.history.filter(h => h !== trimmed), trimmed].slice(-50);
    historyIdx = -1;
    const sess = activeSession();
    const expanded = expandVariables(trimmed);
    const attachLine = attachedFiles.length
      ? `\n\n[attached: ${attachedFiles.map(f => f.name).join(', ')}]`
      : '';
    const userMsg: ChatMessage = {
      id: cryptoId(),
      role: 'user',
      content: expanded + attachLine,
      ts: Date.now()
    };
    sess.messages.push(userMsg);
    if (sess.title === 'New chat') sess.title = autoTitle(expanded);
    sess.updatedAt = Date.now();
    attachedFiles = [];
    renderAttachments();
    saveState();
    input.value = '';
    updateInputUI();
    renderMessages();
    renderSessions();

    maybeAutoSummarize(sess);

    const aiMsg: ChatMessage = {
      id: cryptoId(),
      role: 'assistant',
      content: '',
      ts: Date.now(),
      parentId: userMsg.id
    };
    sess.messages.push(aiMsg);
    renderMessages();
    setStatus('Thinking…', true);
    setStreaming(true);

    const systemBase = personaSystem(state.settings.persona, state.settings.systemOverride);
    const ctxLine = trackContext();
    const summary = sess.summary ? `\n\nEarlier summary: ${sess.summary}` : '';
    const pinNotes = [
      ...state.settings.pinned,
      ...sess.messages.filter(m => m.pinned).map(m => `[${m.role}] ${m.content.slice(0, 160)}`)
    ];
    const pins = pinNotes.length ? `\n\nUser-pinned memory:\n- ${pinNotes.join('\n- ')}` : '';
    const fullSystem = `${systemBase}\n\nLive context: ${ctxLine}${summary}${pins}${WIDGET_HINT}`;

    bumpStreak();
    if (continueBanner) continueBanner.hidden = true;

    abortCtrl = new AbortController();
    const t0 = performance.now();
    let outTokens = 0;
    let stopReason: string | undefined;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          messages: sess.messages
            .filter(m => m.id !== aiMsg.id)
            .map(m => ({ role: m.role, content: m.content })),
          system: fullSystem,
          model: state.settings.model,
          temperature: state.settings.temperature,
          max_tokens: state.settings.maxTokens,
          stream: true
        })
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        const code = (errBody as { error?: string }).error || res.statusText;
        aiMsg.content =
          code === 'ai_not_configured'
            ? '**AI is offline.** The worker needs an `ANTHROPIC_API_KEY` secret before this chat can answer. Tap a quick reply or try again later.'
            : `**Couldn't reach the model.** \`${code}\` — try again in a moment.`;
        renderMessages();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload) as {
              type: string;
              delta?: { text?: string; stop_reason?: string };
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              aiMsg.content += evt.delta.text;
              updateAssistantBubble(aiMsg);
              if (state.settings.showTokenRate && rateBox) {
                outTokens += Math.max(1, Math.ceil(evt.delta.text.length / 4));
                const sec = Math.max(0.001, (performance.now() - t0) / 1000);
                rateBox.hidden = false;
                rateBox.textContent = `${Math.round(outTokens / sec)} tok/s`;
              }
            } else if (evt.type === 'message_delta') {
              if (evt.usage) aiMsg.tokens = evt.usage.output_tokens;
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        aiMsg.content += `\n\n_(stream interrupted: ${(err as Error).message})_`;
        renderMessages();
      }
    } finally {
      abortCtrl = null;
      setStreaming(false);
      setStatus('Ready');
      if (rateBox) rateBox.hidden = true;
      if (stopReason === 'max_tokens' && continueBanner) {
        continueBanner.hidden = false;
      }
      if (aiMsg.content && aiMsg.content.includes('aiwidgets')) {
        const parsed = parseAiWidgets(aiMsg.content);
        if (parsed.widgets.length) {
          aiMsg.content = parsed.text;
          aiMsg.widgets = parsed.widgets;
          renderMessages();
        }
      }
      sess.updatedAt = Date.now();
      saveState();
      renderSessions();
      if (state.settings.sfx) playChime();
    }
  }

  function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const last = state.settings.streakLastOn || '';
    if (last === today) return;
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    state.settings.streakDays = last === y ? (state.settings.streakDays || 0) + 1 : 1;
    state.settings.streakLastOn = today;
    saveState();
    if (streakBadge && state.settings.streakDays > 1) {
      streakBadge.hidden = false;
      streakNum.textContent = String(state.settings.streakDays);
    }
  }

  function updateAssistantBubble(m: ChatMessage) {
    const node = messages.querySelector(`[data-id="${m.id}"] .aichat__msg-body`);
    if (node)
      node.innerHTML = renderMarkdown(m.content) + '<span class="aichat__caret" aria-hidden="true"></span>';
    if (state.settings.autoScroll && !autoScrollLocked) messages.scrollTop = messages.scrollHeight;
  }

  function setStreaming(on: boolean) {
    sendBtn.disabled = on;
    panel.classList.toggle('is-streaming', on);
  }

  // ── Slash registry ────────────────────────────────────────────────────────
  const SLASH_HELP_LINE = (cmd: string, sig: string, desc: string) => `- \`/${cmd}${sig}\` — ${desc}`;
  type SlashRun = (args: string[]) => boolean;
  interface SlashDef {
    sig: string;
    desc: string;
    cat: string;
    run: SlashRun;
    hostHandled?: boolean;
  }
  const SLASH: Record<string, SlashDef> = {
    help: {
      sig: '',
      desc: 'show all commands',
      cat: 'Chat',
      run: () => {
        showSlashHelp();
        return true;
      }
    },
    commands: {
      sig: '',
      desc: 'alias for /help',
      cat: 'Chat',
      run: () => {
        showSlashHelp();
        return true;
      }
    },
    clear: {
      sig: '',
      desc: 'wipe this chat',
      cat: 'Chat',
      run: () => {
        activeSession().messages = [];
        saveState();
        renderMessages();
        return true;
      }
    },
    new: {
      sig: '',
      desc: 'start a fresh chat',
      cat: 'Chat',
      run: () => {
        const s = makeSession();
        state.sessions.unshift(s);
        state.activeId = s.id;
        saveState();
        renderMessages();
        renderSessions();
        return true;
      }
    },
    export: {
      sig: '',
      desc: 'download as Markdown',
      cat: 'Chat',
      run: () => {
        exportSession(activeSession());
        return true;
      }
    },
    share: {
      sig: '',
      desc: 'copy a summary',
      cat: 'Chat',
      run: () => {
        const sess = activeSession();
        const summary = sess.messages
          .slice(-6)
          .map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`)
          .join('\n\n');
        navigator.clipboard?.writeText(summary).then(() => setStatus('Copied to clipboard'));
        return true;
      }
    },
    pin: {
      sig: ' <note>',
      desc: 'pin a memory across chats',
      cat: 'Chat',
      run: args => {
        const note = args.join(' ').trim();
        if (note) {
          state.settings.pinned.push(note);
          saveState();
          setStatus(`Pinned: ${note.slice(0, 40)}`);
        }
        return true;
      }
    },
    notes: {
      sig: ' <text>',
      desc: 'append to bz:notes',
      cat: 'Chat',
      run: args => {
        const note = args.join(' ').trim();
        if (!note) return true;
        try {
          const prev = localStorage.getItem('bz:notes') || '';
          localStorage.setItem(
            'bz:notes',
            prev + (prev ? '\n' : '') + `[${new Date().toISOString().slice(0, 16)}] ${note}`
          );
          setStatus('Saved to notes');
        } catch {
          setStatus('Notes blocked');
        }
        return true;
      }
    },
    wake: {
      sig: ' on|off',
      desc: 'toggle wake-word listener',
      cat: 'Chat',
      run: args => {
        const on = args[0]?.toLowerCase() !== 'off';
        state.settings.wakeWord = on;
        saveState();
        applySettings();
        if (on) startWakeWord();
        else stopWakeWord();
        setStatus(on ? 'Wake word: hey bz' : 'Wake word off');
        return true;
      }
    },
    theme: {
      sig: ' cyan|violet|amber|rose',
      desc: 'switch accent color',
      cat: 'Chat',
      run: args => {
        const t = (args[0] || '').toLowerCase();
        if (t === 'cyan' || t === 'violet' || t === 'amber' || t === 'rose') {
          state.settings.theme = t;
          saveState();
          applySettings();
          setStatus(`Theme: ${t}`);
        }
        return true;
      }
    },
    persona: {
      sig: ' <preset>',
      desc: 'switch voice (dj|coach|theologian|producer|friend|brand|historian|critic)',
      cat: 'Chat',
      run: args => {
        const p = (args[0] || '').toLowerCase() as Persona;
        if (PERSONAS[p]) {
          state.settings.persona = p;
          saveState();
          applySettings();
          setStatus(`Voice: ${PERSONAS[p].label}`);
        } else {
          listPersonas();
        }
        return true;
      }
    },
    snippet: {
      sig: ' save <name> <text> | <name>',
      desc: 'save or recall a draft snippet',
      cat: 'Chat',
      run: args => {
        if (!args.length) {
          listSnippets();
          return true;
        }
        if (args[0] === 'save' && args.length >= 3) {
          const name = args[1];
          const text = args.slice(2).join(' ');
          state.settings.snippets[name] = text;
          saveState();
          setStatus(`Saved snippet "${name}"`);
          return true;
        }
        if (args[0] === 'del' && args[1]) {
          delete state.settings.snippets[args[1]];
          saveState();
          setStatus(`Deleted snippet "${args[1]}"`);
          return true;
        }
        const txt = state.settings.snippets[args[0]];
        if (txt) {
          input.value = txt;
          updateInputUI();
          input.focus();
        } else {
          setStatus(`No snippet "${args[0]}"`);
        }
        return true;
      }
    },
    theatre: {
      sig: ' on|off',
      desc: 'toggle theatre mode',
      cat: 'Chat',
      run: args => {
        const on = args[0] === 'on' ? true : args[0] === 'off' ? false : !state.settings.theatreMode;
        state.settings.theatreMode = on;
        saveState();
        applySettings();
        setStatus(`Theatre ${on ? 'on' : 'off'}`);
        return true;
      }
    },
    spectro: {
      sig: ' on|off',
      desc: 'toggle spectrogram backdrop',
      cat: 'Chat',
      run: args => {
        const on = args[0] === 'on' ? true : args[0] === 'off' ? false : !state.settings.spectrogramBackdrop;
        state.settings.spectrogramBackdrop = on;
        saveState();
        applySettings();
        return true;
      }
    },
    cheatsheet: {
      sig: '',
      desc: 'keyboard shortcuts card',
      cat: 'Chat',
      run: () => {
        openCheat();
        return true;
      }
    },
    poster: {
      sig: '',
      desc: 'save conversation as poster (PNG)',
      cat: 'Chat',
      run: () => {
        savePoster();
        return true;
      }
    },
    summary: {
      sig: '',
      desc: 'show running summary of this chat',
      cat: 'Chat',
      run: () => {
        const sess = activeSession();
        const s = sess.summary || '(no summary yet — keep chatting)';
        sess.messages.push({
          id: cryptoId(),
          role: 'assistant',
          ts: Date.now(),
          content: `**Running summary**\n\n${s}`
        });
        saveState();
        renderMessages();
        return true;
      }
    },
    today: {
      sig: '',
      desc: 'daily ritual prompt',
      cat: 'Chat',
      run: () => {
        sendRitualPrompt();
        return true;
      }
    },
    critique: {
      sig: '',
      desc: 'critique the last reply',
      cat: 'Chat',
      run: () => {
        critiqueLast();
        return true;
      }
    },
    rewrite: {
      sig: ' <tighter|punchier|shorter|gospel|simple>',
      desc: 'rewrite the last reply',
      cat: 'Chat',
      run: args => {
        rewriteLast(args.join(' ').trim());
        return true;
      }
    },
    lyric: {
      sig: '',
      desc: 'explain the current lyric line',
      cat: 'Intel',
      run: () => {
        const line = currentLyric();
        if (!line) {
          setStatus('No lyric loaded');
          return true;
        }
        send(`Explain this lyric line in 2-3 sentences, then quote one Greene-style maxim: "${line}"`);
        return true;
      }
    },
    mood: {
      sig: ' <word>',
      desc: 'suggest tracks for a mood',
      cat: 'Intel',
      run: args => {
        suggestForMood(args.join(' '));
        return true;
      }
    },
    blend: {
      sig: ' <id-a> <id-b>',
      desc: 'design a transition between two tracks',
      cat: 'Intel',
      run: args => {
        blendTracks(args[0], args[1]);
        return true;
      }
    },
    setlist: {
      sig: ' <n>',
      desc: 'auto-build an n-track setlist',
      cat: 'Intel',
      run: args => {
        buildSetlist(Number(args[0]) || 6);
        return true;
      }
    },
    catalog: {
      sig: '',
      desc: 'list every track on the site',
      cat: 'Intel',
      run: () => {
        listCatalog();
        return true;
      }
    },
    shortcommands: {
      sig: '',
      desc: 'rich palette of every slash command',
      cat: 'Chat',
      run: () => {
        showShortCommands();
        return true;
      }
    },
    sc: {
      sig: '',
      desc: 'alias for /shortcommands',
      cat: 'Chat',
      run: () => {
        showShortCommands();
        return true;
      }
    },
    track: {
      sig: ' <id>',
      desc: 'show a track card widget',
      cat: 'Intel',
      run: args => {
        showTrackCard(args[0]);
        return true;
      }
    },
    album: {
      sig: ' <id>',
      desc: 'show an album card widget',
      cat: 'Intel',
      run: args => {
        showAlbumCard(args[0]);
        return true;
      }
    },
    play: { sig: '', desc: 'resume playback', cat: 'Playback', hostHandled: true, run: () => false },
    pause: { sig: '', desc: 'pause playback', cat: 'Playback', hostHandled: true, run: () => false },
    toggle: { sig: '', desc: 'play/pause toggle', cat: 'Playback', hostHandled: true, run: () => false },
    stop: { sig: '', desc: 'stop playback', cat: 'Playback', hostHandled: true, run: () => false },
    next: { sig: '', desc: 'next track', cat: 'Playback', hostHandled: true, run: () => false },
    prev: { sig: '', desc: 'previous track', cat: 'Playback', hostHandled: true, run: () => false },
    previous: { sig: '', desc: 'alias for /prev', cat: 'Playback', hostHandled: true, run: () => false },
    back: { sig: '', desc: 'replay last track', cat: 'Playback', hostHandled: true, run: () => false },
    seek: {
      sig: ' <m:ss|0.5>',
      desc: 'jump to time or ratio',
      cat: 'Playback',
      hostHandled: true,
      run: () => false
    },
    loop: { sig: ' <m:ss>-<m:ss>', desc: 'A↔B loop', cat: 'Playback', hostHandled: true, run: () => false },
    loopstop: { sig: '', desc: 'cancel A↔B loop', cat: 'Playback', hostHandled: true, run: () => false },
    speed: { sig: ' <0.5-2>', desc: 'playback rate', cat: 'Playback', hostHandled: true, run: () => false },
    pitch: {
      sig: ' on|off',
      desc: 'preserve pitch when speed≠1',
      cat: 'Playback',
      hostHandled: true,
      run: () => false
    },
    sleep: {
      sig: ' <m|track|album>',
      desc: 'sleep timer w/ fade-out',
      cat: 'Playback',
      hostHandled: true,
      run: () => false
    },
    like: { sig: '', desc: 'like current track', cat: 'Playback', hostHandled: true, run: () => false },
    queue: {
      sig: ' list|clear',
      desc: 'show or wipe queue',
      cat: 'Queue',
      hostHandled: true,
      run: () => false
    },
    shuffle: { sig: ' on|off', desc: 'shuffle queue', cat: 'Queue', hostHandled: true, run: () => false },
    repeat: { sig: ' one|all|off', desc: 'repeat mode', cat: 'Queue', hostHandled: true, run: () => false },
    viz: {
      sig: ' <mode|next|surprise>',
      desc: 'switch visualizer',
      cat: 'Viz',
      hostHandled: true,
      run: () => false
    },
    trails: { sig: ' on|off', desc: 'long-exposure trails', cat: 'Viz', hostHandled: true, run: () => false },
    palette: {
      sig: ' <hex|album|mono>',
      desc: 'recolor viz palette',
      cat: 'Viz',
      hostHandled: true,
      run: () => false
    },
    eq: {
      sig: ' <band|preset>',
      desc: 'bass/mid/treble or preset',
      cat: 'Audio',
      hostHandled: true,
      run: () => false
    },
    reverb: {
      sig: ' <preset|wet 0-1>',
      desc: 'reverb preset or wet mix',
      cat: 'Audio',
      hostHandled: true,
      run: () => false
    },
    instrumental: {
      sig: ' on|off',
      desc: 'karaoke center-cut',
      cat: 'Audio',
      hostHandled: true,
      run: () => false
    },
    cast: { sig: '', desc: 'Chromecast picker', cat: 'Share', hostHandled: true, run: () => false },
    airplay: { sig: '', desc: 'AirPlay picker', cat: 'Share', hostHandled: true, run: () => false },
    clip: {
      sig: ' <seconds>',
      desc: 'record a snippet clip',
      cat: 'Share',
      hostHandled: true,
      run: () => false
    },
    snap: { sig: '', desc: 'screenshot the viz', cat: 'Share', hostHandled: true, run: () => false },
    sendto: {
      sig: ' <name>',
      desc: 'recommend to a friend',
      cat: 'Share',
      hostHandled: true,
      run: () => false
    },
    find: {
      sig: ' <lyric|feel|collab> <q>',
      desc: 'search the catalog',
      cat: 'Intel',
      hostHandled: true,
      run: () => false
    },
    explain: {
      sig: '',
      desc: 'explain the current lyric',
      cat: 'Intel',
      hostHandled: true,
      run: () => false
    },
    why: { sig: '', desc: 'why this beat hits', cat: 'Intel', hostHandled: true, run: () => false },
    translate: {
      sig: ' <lang>',
      desc: 'translate active lyrics',
      cat: 'Intel',
      hostHandled: true,
      run: () => false
    },
    quote: {
      sig: ' <chorus|verse>',
      desc: 'copy a section to clipboard',
      cat: 'Intel',
      hostHandled: true,
      run: () => false
    },
    debug: { sig: '', desc: 'open replay-debug overlay', cat: 'Intel', hostHandled: true, run: () => false },
    stats: {
      sig: '',
      desc: 'top tracks by plays + shares',
      cat: 'Intel',
      run: () => {
        showStats();
        return true;
      }
    }
  };

  function showSlashHelp() {
    const cats: Record<string, string[]> = {};
    for (const [key, def] of Object.entries(SLASH)) {
      (cats[def.cat] ||= []).push(SLASH_HELP_LINE(key, def.sig, def.desc));
    }
    const body = Object.entries(cats)
      .map(([cat, lines]) => `**${cat}**\n${lines.join('\n')}`)
      .join('\n\n');
    const widget = buildShortCommandsPalette(SLASH);
    pushAssistantWithWidgets(
      `**${Object.keys(SLASH).length} slash commands**\n\n${body}\n\nType \`/\` to autocomplete, ⌘K to search, ⌘F to search messages.`,
      [widget]
    );
  }

  function handleSlash(text: string): boolean {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const lc = cmd.toLowerCase();
    const def = SLASH[lc];
    if (def && !def.hostHandled) {
      def.run(args);
      return true;
    }
    if (opts.onCommand && opts.onCommand(lc, args) === true) return true;
    if (def?.hostHandled) {
      setStatus(`/${lc} not wired in this build`);
      return true;
    }
    return false;
  }

  function exportSession(sess: ChatSession) {
    const md = sess.messages.map(m => `## ${m.role === 'user' ? 'You' : 'bZ'}\n\n${m.content}\n`).join('\n');
    const blob = new Blob([`# ${sess.title}\n\n${md}`], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sess.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function listPersonas() {
    const lines = Object.entries(PERSONAS)
      .map(([k, p]) => `- \`/persona ${k}\` — ${p.emoji} ${p.label}`)
      .join('\n');
    pushAssistant(`**Voices**\n\n${lines}`);
  }
  function listSnippets() {
    const ss = state.settings.snippets;
    const keys = Object.keys(ss);
    if (!keys.length) {
      pushAssistant('No saved snippets yet. Save one with `/snippet save <name> <text>`.');
      return;
    }
    pushAssistant(
      '**Snippets**\n\n' + keys.map(k => `- \`/snippet ${k}\` — ${ss[k].slice(0, 60)}`).join('\n')
    );
  }
  function listCatalog() {
    const byAlbum = ALBUMS.map(al => {
      const ts = tracksForAlbum(al.id);
      if (!ts.length) return '';
      return `**${al.name}** — ${al.tagline}\n${ts.map(t => `- \`${t.id}\` · ${t.title} · ${t.vibe}`).join('\n')}`;
    })
      .filter(Boolean)
      .join('\n\n');
    pushAssistant(`**Catalog (${TRACKS.length} tracks across ${ALBUMS.length} albums)**\n\n${byAlbum}`);
  }

  function showShortCommands() {
    const widget = buildShortCommandsPalette(SLASH);
    const totals = `${Object.keys(SLASH).length} commands across ${widget.groups.length} groups`;
    pushAssistantWithWidgets(`**Shortcommands** — ${totals}.`, [widget]);
  }

  async function showStats() {
    setStatus('Fetching stats…');
    try {
      const res = await fetch('/api/stats', { headers: { accept: 'application/json' } });
      if (!res.ok) {
        pushAssistant(`Could not load /api/stats (HTTP ${res.status}).`);
        setStatus('');
        return;
      }
      const data = (await res.json()) as { tracks?: Record<string, { plays?: number; shares?: number }> };
      const entries = Object.entries(data.tracks || {});
      if (!entries.length) {
        pushAssistant('No play or share data yet — counters are warming up.');
        setStatus('');
        return;
      }
      const top = entries
        .map(([id, v]) => ({ id, plays: Number(v.plays) || 0, shares: Number(v.shares) || 0 }))
        .sort((a, b) => b.plays + b.shares - (a.plays + a.shares))
        .slice(0, 10);
      const labels = top.map(t => TRACK_BY_ID.get(t.id)?.title || t.id);
      const playsChart: AiChatWidget = {
        kind: 'chart',
        title: `Top ${top.length} tracks by plays`,
        label: labels.join(' · '),
        series: top.map(t => t.plays),
        unit: 'plays',
        variant: 'bar',
        caption: `Σ plays ${top.reduce((s, t) => s + t.plays, 0)} · Σ shares ${top.reduce((s, t) => s + t.shares, 0)}`
      };
      const rows = top.map(t => ({
        label: TRACK_BY_ID.get(t.id)?.title || t.id,
        values: [String(t.plays), String(t.shares)]
      }));
      const table: AiChatWidget = {
        kind: 'comparison-table',
        caption: 'Plays vs. shares',
        columns: ['Track', 'Plays', 'Shares'],
        rows
      };
      pushAssistantWithWidgets(
        `**Stats** — ${entries.length} tracks counted; showing top ${top.length}.`,
        [playsChart, table]
      );
    } catch {
      pushAssistant('Stats fetch failed — try again in a moment.');
    } finally {
      setStatus('');
    }
  }

  function showTrackCard(id: string | undefined) {
    if (!id) {
      setStatus('Try: /track birch-swing-heaven');
      return;
    }
    const t = TRACK_BY_ID.get(id);
    if (!t) {
      setStatus(`Unknown track "${id}" — see /catalog`);
      return;
    }
    const album = ALBUM_BY_ID.get(t.album);
    const albumName = album?.name ?? t.album;
    pushAssistantWithWidgets(`**${t.title}** · ${albumName}`, [
      {
        kind: 'track-card',
        trackId: t.id,
        title: t.title,
        album: albumName,
        vibe: t.vibe,
        cover: t.cover,
        href: album ? `/${album.id}/${t.id}` : `/${t.id}`
      }
    ]);
  }

  function showAlbumCard(id: string | undefined) {
    if (!id) {
      setStatus('Try: /album canopy-dispatch');
      return;
    }
    const a = ALBUM_BY_ID.get(id);
    if (!a) {
      setStatus(`Unknown album "${id}"`);
      return;
    }
    const tracks = tracksForAlbum(a.id);
    pushAssistantWithWidgets(`**${a.name}** — ${a.tagline}`, [
      {
        kind: 'album-card',
        albumId: a.id,
        name: a.name,
        tagline: a.tagline,
        cover: a.cover,
        trackCount: tracks.length,
        href: `/${a.id}`
      }
    ]);
  }

  function pushAssistant(content: string) {
    const sess = activeSession();
    sess.messages.push({ id: cryptoId(), role: 'assistant', ts: Date.now(), content });
    sess.updatedAt = Date.now();
    saveState();
    renderMessages();
    renderSessions();
  }

  function pushAssistantWithWidgets(content: string, widgets: AiChatWidget[]) {
    const sess = activeSession();
    sess.messages.push({
      id: cryptoId(),
      role: 'assistant',
      ts: Date.now(),
      content,
      widgets
    });
    sess.updatedAt = Date.now();
    saveState();
    renderMessages();
    renderSessions();
  }

  function critiqueLast() {
    const sess = activeSession();
    const last = [...sess.messages].reverse().find(m => m.role === 'assistant' && m.content.trim());
    if (!last) {
      setStatus('Nothing to critique');
      return;
    }
    send(
      `Critique your previous reply ("${last.content.slice(0, 200).replace(/"/g, "'")}…") for: tightness, clarity, banned filler, accuracy, brand voice. Then rewrite it in 2-3 sentences.`
    );
  }
  function rewriteLast(style: string) {
    const sess = activeSession();
    const last = [...sess.messages].reverse().find(m => m.role === 'assistant' && m.content.trim());
    if (!last) {
      setStatus('Nothing to rewrite');
      return;
    }
    const mode = style || 'tighter';
    send(`Rewrite your previous reply in a ${mode} style. Original:\n\n${last.content}`);
  }
  function suggestForMood(mood: string) {
    if (!mood) {
      setStatus('Add a mood: /mood late-night');
      return;
    }
    const ctx = TRACKS.slice(0, 30)
      .map(t => `- ${t.id} · ${t.title} · ${t.vibe}`)
      .join('\n');
    send(
      `Pick 3 bZ tracks from this catalog that match the mood "${mood}". Format: track id + 1-line why. Catalog:\n\n${ctx}`
    );
  }
  function blendTracks(a: string, b: string) {
    if (!a || !b) {
      setStatus('Try: /blend birch-swing-heaven panda-dump');
      return;
    }
    const A = TRACK_BY_ID.get(a);
    const B = TRACK_BY_ID.get(b);
    if (!A || !B) {
      setStatus('Unknown track id — see /catalog');
      return;
    }
    send(
      `Design a 16-bar transition from "${A.title}" (${A.vibe}) into "${B.title}" (${B.vibe}). Call out key, BPM ramp, EQ moves, and the emotional handoff. 4 short paragraphs.`
    );
  }
  function buildSetlist(n: number) {
    const eng = opts.engine?.state();
    const seed = eng?.track ? `Open with "${eng.track.title}".` : '';
    const ctx = TRACKS.slice(0, 24)
      .map(t => `- ${t.id} · ${t.title} · ${t.vibe}`)
      .join('\n');
    send(
      `Build a ${n}-track bZ setlist with a clear arc (entry → peak → comedown). ${seed} For each, give: track id, one-line transition note. Catalog excerpt:\n\n${ctx}`
    );
  }
  function sendRitualPrompt() {
    const today = new Date().toISOString().slice(0, 10);
    state.settings.dailyRitualSeenOn = today;
    saveState();
    ritual.hidden = true;
    send("Give me today's one-line prayer, one wisdom verse, and one move for the day. Hard but holy.");
  }
  function maybeShowRitual() {
    const today = new Date().toISOString().slice(0, 10);
    if (state.settings.dailyRitualSeenOn === today) return;
    ritual.hidden = false;
    ritual.innerHTML = `<span>Daily ritual ready —</span><button type="button" data-aichat="ritualGo">/today</button><button type="button" data-aichat="ritualSkip" aria-label="Skip">✕</button>`;
  }

  function openCheat() {
    sheetBackdrop.hidden = false;
    try {
      cheatBox.showModal();
    } catch {
      cheatBox.setAttribute('open', '');
    }
  }
  function closeCheat() {
    try {
      cheatBox.close();
    } catch {
      cheatBox.removeAttribute('open');
    }
    sheetBackdrop.hidden = true;
  }

  function savePoster() {
    const sess = activeSession();
    const W = 1080,
      H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('Canvas unsupported');
      return;
    }
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#060610');
    grad.addColorStop(0.6, '#0b0b22');
    grad.addColorStop(1, '#1a0a2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#00E5FF';
    ctx.font = 'bold 56px "Space Grotesk", system-ui';
    ctx.fillText('Ask bZ', 64, 120);
    ctx.fillStyle = '#fff';
    ctx.font = '600 36px "Space Grotesk", system-ui';
    wrapLine(ctx, sess.title, 64, 180, W - 128, 44);
    ctx.font = '24px "Inter", system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    let y = 280;
    for (const m of sess.messages.slice(-8)) {
      if (y > H - 200) break;
      ctx.fillStyle = m.role === 'user' ? '#7C3AED' : '#00E5FF';
      ctx.font = 'bold 20px "Space Grotesk", system-ui';
      ctx.fillText(m.role === 'user' ? 'YOU' : 'BZ', 64, y);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '22px "Inter", system-ui';
      y = wrapLine(ctx, m.content.slice(0, 280), 64, y + 28, W - 128, 30) + 24;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '20px "JetBrains Mono", monospace';
    ctx.fillText('music.megabyte.space', 64, H - 56);
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `bz-chat-${sess.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Poster saved');
    }, 'image/png');
  }
  function wrapLine(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    lh: number
  ): number {
    const words = text.split(/\s+/);
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, x, yy);
        line = w;
        yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
    return yy;
  }

  // ── Wake-word listener ────────────────────────────────────────────────────
  let wakeRec: { stop: () => void } | null = null;
  function startWakeWord() {
    if (wakeRec) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus('Wake word needs Chrome / Edge');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e: SREvent) => {
      const last = e.results.length - 1;
      const t = (
        e.results[last] as unknown as { [i: number]: { transcript: string } }
      )[0].transcript.toLowerCase();
      if (/(^|\s)(hey\s+)?b\.?z\.?\b/.test(t) || t.includes('hey beasie')) {
        setOpen(true);
        input.focus();
        setStatus('Listening — wake word');
        toggleVoice();
      }
    };
    rec.onend = () => {
      wakeRec = null;
      if (state.settings.wakeWord) startWakeWord();
    };
    rec.onerror = () => {
      wakeRec = null;
    };
    try {
      rec.start();
      wakeRec = { stop: () => rec.stop() };
    } catch {
      wakeRec = null;
    }
  }
  function stopWakeWord() {
    if (!wakeRec) return;
    try {
      wakeRec.stop();
    } catch {}
    wakeRec = null;
  }

  // ── Slash autocomplete ────────────────────────────────────────────────────
  const suggestBox = document.createElement('div');
  suggestBox.className = 'aichat__suggest';
  suggestBox.setAttribute('role', 'listbox');
  suggestBox.hidden = true;
  let suggestIdx = 0;
  let suggestList: string[] = [];
  function renderSuggest() {
    if (!suggestList.length) {
      suggestBox.hidden = true;
      return;
    }
    suggestBox.hidden = false;
    suggestBox.innerHTML = suggestList
      .map((k, i) => {
        const def = SLASH[k];
        const cls = i === suggestIdx ? 'aichat__suggest-item is-active' : 'aichat__suggest-item';
        return `<button type="button" class="${cls}" data-suggest="${k}" role="option" aria-selected="${i === suggestIdx}"><code>/${k}${escapeHtml(def.sig)}</code><span>${escapeHtml(def.desc)}</span></button>`;
      })
      .join('');
  }
  function updateSuggest() {
    const v = input.value;
    if (!v.startsWith('/')) {
      suggestList = [];
      suggestIdx = 0;
      renderSuggest();
      return;
    }
    const prefix = v.slice(1).split(/\s/)[0].toLowerCase();
    if (v.includes(' ')) {
      suggestList = [];
      renderSuggest();
      return;
    }
    suggestList = Object.keys(SLASH)
      .filter(k => k.startsWith(prefix))
      .slice(0, 8);
    if (suggestIdx >= suggestList.length) suggestIdx = 0;
    renderSuggest();
  }
  function applySuggest(key: string) {
    input.value = '/' + key + (SLASH[key].sig.startsWith(' ') ? ' ' : '');
    suggestList = [];
    renderSuggest();
    updateInputUI();
    input.focus();
  }
  composer.insertBefore(suggestBox, composer.firstChild);
  suggestBox.addEventListener('mousedown', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-suggest]');
    if (!btn) return;
    e.preventDefault();
    applySuggest(btn.dataset.suggest!);
  });

  // ── @track mention popover ───────────────────────────────────────────────
  function detectMentionQuery(): { q: string; at: number } | null {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && /[\w]/.test(before[at - 1])) return null;
    const q = before.slice(at + 1);
    if (!/^[a-z0-9\- ]{0,32}$/i.test(q)) return null;
    return { q: q.toLowerCase(), at };
  }
  function renderMention() {
    if (!mentionList.length) {
      mention.hidden = true;
      mention.innerHTML = '';
      return;
    }
    mention.hidden = false;
    mention.innerHTML = mentionList
      .map((t, i) => {
        const cls = i === mentionIdx ? 'aichat__mention-item is-active' : 'aichat__mention-item';
        return `<button type="button" class="${cls}" data-mention="${t.id}" role="option" aria-selected="${i === mentionIdx}"><span>${escapeHtml(t.title)}</span><em>${escapeHtml(t.vibe || '')}</em></button>`;
      })
      .join('');
  }
  function updateMention() {
    const m = detectMentionQuery();
    if (!m) {
      mentionList = [];
      mentionAnchor = -1;
      renderMention();
      return;
    }
    mentionAnchor = m.at;
    const q = m.q;
    mentionList = TRACKS.filter(
      t =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        (t.vibe || '').toLowerCase().includes(q)
    ).slice(0, 6);
    if (mentionIdx >= mentionList.length) mentionIdx = 0;
    renderMention();
  }
  function applyMention(t: Track) {
    if (mentionAnchor < 0) return;
    const before = input.value.slice(0, mentionAnchor);
    const caret = input.selectionStart ?? input.value.length;
    const after = input.value.slice(caret);
    const insert = `@${t.id} `;
    input.value = before + insert + after;
    const newPos = before.length + insert.length;
    input.setSelectionRange(newPos, newPos);
    mentionList = [];
    mentionAnchor = -1;
    renderMention();
    updateInputUI();
    input.focus();
  }
  mention.addEventListener('mousedown', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mention]');
    if (!btn) return;
    e.preventDefault();
    const t = TRACK_BY_ID.get(btn.dataset.mention!);
    if (t) applyMention(t);
  });

  // ── Message search (⌘F) ──────────────────────────────────────────────────
  function openMsearch() {
    msearch.hidden = false;
    msearchInput.focus();
    msearchInput.select();
  }
  function closeMsearch() {
    msearch.hidden = true;
    msearchInput.value = '';
    clearMsearchHighlights();
  }
  function clearMsearchHighlights() {
    messages
      .querySelectorAll<HTMLElement>('.aichat__msg.is-match')
      .forEach(el => el.classList.remove('is-match'));
    messages.querySelectorAll<HTMLElement>('mark[data-msearch]').forEach(mk => {
      const parent = mk.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(mk.textContent || ''), mk);
    });
    msearchMatches = [];
    msearchIdx = 0;
    msearchCount.textContent = '0';
  }
  function runMsearch(q: string) {
    clearMsearchHighlights();
    if (!q.trim()) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    messages.querySelectorAll<HTMLElement>('.aichat__msg').forEach(li => {
      const body = li.querySelector('.aichat__msg-body');
      if (!body) return;
      const html = body.innerHTML.replace(/<mark data-msearch>(.*?)<\/mark>/g, '$1');
      const next = html.replace(re, m => `<mark data-msearch>${m}</mark>`);
      if (next !== html) {
        body.innerHTML = next;
        li.classList.add('is-match');
        msearchMatches.push(li);
      }
    });
    msearchCount.textContent = String(msearchMatches.length);
    if (msearchMatches.length) msearchMatches[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function stepMsearch(dir: 1 | -1) {
    if (!msearchMatches.length) return;
    msearchIdx = (msearchIdx + dir + msearchMatches.length) % msearchMatches.length;
    msearchMatches[msearchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── Now-playing chip + audio-reactive glow ───────────────────────────────
  let lastCoverSrc = '';
  let lastFabTitle = '';
  function refreshNow() {
    const st = opts.engine?.state();
    if (!st?.track) {
      now.hidden = true;
      if (lastFabTitle) {
        fabTip.hidden = true;
        fabTip.textContent = '';
        lastFabTitle = '';
      }
      return;
    }
    now.hidden = false;
    nowTitle.textContent = st.track.title;
    const min = Math.floor((st.currentTime || 0) / 60);
    const sec = Math.floor((st.currentTime || 0) % 60)
      .toString()
      .padStart(2, '0');
    nowMeta.textContent = `${st.track.artist || 'bZ'} · ${min}:${sec}${st.playing ? '' : ' · paused'}`;

    const coverUrl = st.track.cover || '';
    if (coverUrl && coverUrl !== lastCoverSrc) {
      lastCoverSrc = coverUrl;
      let img = nowCover.querySelector<HTMLImageElement>('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        nowCover.insertBefore(img, nowCover.firstChild);
      }
      img.src = coverUrl;
      nowInitial.textContent = '';
    } else if (!coverUrl) {
      lastCoverSrc = '';
      const oldImg = nowCover.querySelector('img');
      if (oldImg) oldImg.remove();
      nowInitial.textContent = (st.track.title || 'b').charAt(0).toLowerCase();
    }

    const tags = getTrackTags(st.track.id);
    const chips: string[] = [];
    const bpm = Math.round(st.bpm || tags?.identifiers.bpmHint || 0);
    if (bpm > 30) chips.push(`<span class="aichat__now-chip">${bpm} BPM</span>`);
    if (tags?.energy)
      chips.push(`<span class="aichat__now-chip aichat__now-chip--violet">${tags.energy}</span>`);
    if (tags?.tempo && tags.tempo !== 'medium')
      chips.push(`<span class="aichat__now-chip">${tags.tempo}</span>`);
    const firstMood = tags?.moods[0];
    if (firstMood) chips.push(`<span class="aichat__now-chip aichat__now-chip--violet">${firstMood}</span>`);
    nowChips.innerHTML = chips.join('');

    if (state.settings.themeFromAlbum && st.track.album) {
      const map: Record<string, Settings['theme']> = {
        desiiignare: 'cyan',
        dump: 'violet',
        canon: 'amber',
        halo: 'rose',
        galactic: 'violet'
      };
      const t = map[st.track.album];
      if (t && t !== state.settings.theme) {
        state.settings.theme = t;
        root.setAttribute('data-theme', t);
        root
          .querySelectorAll<HTMLButtonElement>('[data-aichat="themeSwatch"] button')
          .forEach(b => b.classList.toggle('is-active', b.dataset.theme === t));
        saveState();
      }
    }

    if (st.track.title !== lastFabTitle) {
      lastFabTitle = st.track.title;
      if (!panel.classList.contains('is-open') && st.playing) {
        fabTip.hidden = false;
        fabTip.textContent = `♪ ${st.track.title}`;
        clearTimeout(fabTipTimer);
        fabTipTimer = window.setTimeout(() => {
          fabTip.hidden = true;
        }, 4200);
      }
    }
  }
  let fabTipTimer: number = 0;

  function rafLoop() {
    refreshNow();
    const eng = opts.engine;
    if (state.settings.reactiveGlow && eng?.analyser) {
      const a = eng.analyser;
      const buf = new Uint8Array(a.fftSize);
      try {
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const amp = Math.min(1, rms * 2.4);
        root.style.setProperty('--aichat-amp', amp.toFixed(3));
      } catch {}
    } else {
      root.style.setProperty('--aichat-amp', '0');
    }
    if (state.settings.spectrogramBackdrop && eng?.analyser && panel.classList.contains('is-open')) {
      drawSpectro(eng.analyser);
    }
    if (state.settings.beatSyncCaret) {
      const st = eng?.state();
      const pulse = Math.min(1, Math.max(0, st?.beatPulse ?? 0));
      root.style.setProperty('--aichat-beat', pulse.toFixed(3));
    }
    requestAnimationFrame(rafLoop);
  }

  function drawSpectro(a: AnalyserNode) {
    const c = spectro.getContext('2d');
    if (!c) return;
    const rect = spectro.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (spectro.width !== W || spectro.height !== H) {
      spectro.width = W;
      spectro.height = H;
    }
    const bins = a.frequencyBinCount;
    const data = new Uint8Array(bins);
    a.getByteFrequencyData(data);
    c.clearRect(0, 0, W, H);
    const cols = 48;
    const colW = W / cols;
    const step = Math.max(1, Math.floor(bins / cols));
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      const v = sum / step / 255;
      const barH = Math.pow(v, 1.4) * H * 0.95;
      const grad = c.createLinearGradient(0, H - barH, 0, H);
      grad.addColorStop(0, 'rgba(0,229,255,0.55)');
      grad.addColorStop(0.6, 'rgba(124,58,237,0.32)');
      grad.addColorStop(1, 'rgba(124,58,237,0)');
      c.fillStyle = grad;
      const x = i * colW + colW * 0.12;
      const w = colW * 0.76;
      c.fillRect(x, H - barH, w, barH);
    }
  }

  // ── Rotating welcome prompts ─────────────────────────────────────────────
  let rotIdx = 0;
  function rotateWelcome() {
    if (welcome.hasAttribute('hidden')) return;
    rotIdx = (rotIdx + 1) % ROTATING_PROMPTS.length;
    welcomeRotating.textContent = ROTATING_PROMPTS[rotIdx];
    welcomeRotating.classList.remove('is-in');
    void welcomeRotating.offsetWidth;
    welcomeRotating.classList.add('is-in');
  }
  setInterval(rotateWelcome, 3800);
  welcomeRotating.textContent = ROTATING_PROMPTS[0];
  welcomeRotating.classList.add('is-in');

  // ── SFX chime ────────────────────────────────────────────────────────────
  function playChime() {
    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {}
  }

  // ── Attachments / drag-drop ──────────────────────────────────────────────
  function renderAttachments() {
    if (!attachedFiles.length) {
      attachments.hidden = true;
      attachments.innerHTML = '';
      return;
    }
    attachments.hidden = false;
    attachments.innerHTML = attachedFiles
      .map(
        (f, i) =>
          `<span class="aichat__attach-chip">${escapeHtml(f.name)}<button type="button" data-rmattach="${i}" aria-label="Remove ${escapeHtml(f.name)}">✕</button></span>`
      )
      .join('');
  }
  attachments.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rmattach]');
    if (!btn) return;
    attachedFiles.splice(Number(btn.dataset.rmattach), 1);
    renderAttachments();
  });

  function updateInputUI() {
    const len = input.value.length;
    counter.textContent = String(len);
    sendBtn.disabled = len === 0 || !!abortCtrl;
    input.style.height = 'auto';
    input.style.height = Math.min(180, input.scrollHeight) + 'px';
    meter.classList.toggle('is-warn', len > 1200);
    meter.classList.toggle('is-over', len > 3500);
    refreshUrlHint();
    refreshSnipBar();
  }

  const URL_RE = /(https?:\/\/[^\s]+)/i;
  function refreshUrlHint() {
    if (!urlhint) return;
    const m = input.value.match(URL_RE);
    if (!m) {
      urlhint.hidden = true;
      return;
    }
    const url = m[1];
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    if (
      !/spotify\.com|youtube\.com|youtu\.be|soundcloud\.com|apple\.com\/.+music|tidal\.com|bandcamp\.com/.test(
        host
      )
    ) {
      urlhint.hidden = true;
      return;
    }
    urlhint.hidden = false;
    urlhint.innerHTML = `<span>${escapeHtml(host)} link detected.</span>
      <button type="button" data-urlplay="${escapeHtml(url)}">Open ↗</button>`;
  }

  function refreshSnipBar() {
    if (!snipbar) return;
    const text = input.value;
    const m = text.match(/\/([a-zA-Z][\w-]{0,40})$/);
    if (!m) {
      snipbar.hidden = true;
      return;
    }
    const stub = m[1].toLowerCase();
    const ss = state.settings.snippets || {};
    const keys = Object.keys(ss)
      .filter(k => k.toLowerCase().startsWith(stub))
      .slice(0, 6);
    if (!keys.length) {
      snipbar.hidden = true;
      return;
    }
    snipbar.hidden = false;
    snipbar.innerHTML = keys
      .map(k => `<button type="button" data-snip="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
      .join('');
  }

  function bind() {
    fab.addEventListener('click', () => setOpen(true));
    $('close').addEventListener('click', () => setOpen(false));

    $('new').addEventListener('click', () => {
      const s = makeSession();
      state.sessions.unshift(s);
      state.activeId = s.id;
      saveState();
      renderMessages();
      renderSessions();
      input.focus();
    });

    $('sessions').addEventListener('click', () => {
      const open = sidebar.classList.contains('is-open');
      settingsPanel.classList.remove('is-open');
      sidebar.classList.toggle('is-open', !open);
      if (!open) {
        searchSessions.value = '';
        renderSessions();
        const body = sidebar.querySelector<HTMLElement>('.aichat__drawer-body');
        if (body) body.scrollTop = 0;
        setTimeout(() => searchSessions.focus(), 320);
      }
    });
    $('sidebarClose').addEventListener('click', () => sidebar.classList.remove('is-open'));
    if (searchSessionsClear) {
      searchSessionsClear.addEventListener('click', () => {
        searchSessions.value = '';
        renderSessions();
        searchSessions.focus();
      });
    }

    $('settings').addEventListener('click', () => {
      const open = settingsPanel.classList.contains('is-open');
      sidebar.classList.remove('is-open');
      settingsPanel.classList.toggle('is-open', !open);
    });
    $('settingsClose').addEventListener('click', () => settingsPanel.classList.remove('is-open'));

    $('search').addEventListener('click', () => openMsearch());
    $('msearchClose').addEventListener('click', () => closeMsearch());
    $('msearchNext').addEventListener('click', () => stepMsearch(1));
    $('msearchPrev').addEventListener('click', () => stepMsearch(-1));
    msearchInput.addEventListener('input', () => runMsearch(msearchInput.value));
    msearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        stepMsearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMsearch();
      }
    });

    now.addEventListener('click', () => {
      const st = opts.engine?.state();
      if (!st?.track) return;
      input.value = `Tell me about "${st.track.title}" by ${st.track.artist || 'bZ'}.`;
      updateInputUI();
      input.focus();
    });

    sessionList.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const del = t.closest<HTMLButtonElement>('[data-del]');
      if (del) {
        const id = del.dataset.del!;
        state.sessions = state.sessions.filter(s => s.id !== id);
        if (state.sessions.length === 0) state.sessions = [makeSession()];
        if (state.activeId === id) state.activeId = state.sessions[0].id;
        saveState();
        renderSessions();
        renderMessages();
        return;
      }
      const btn = t.closest<HTMLButtonElement>('[data-id]');
      if (btn) {
        state.activeId = btn.dataset.id!;
        saveState();
        renderSessions();
        renderMessages();
        sidebar.classList.remove('is-open');
        input.focus();
      }
    });
    searchSessions.addEventListener('input', () => renderSessions(searchSessions.value));

    messages.addEventListener('scroll', () => {
      const atBottom = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 24;
      autoScrollLocked = !atBottom;
      scrollBtm.hidden = atBottom;
    });
    scrollBtm.addEventListener('click', () => scrollToBottom());

    messages.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const tool = t.closest<HTMLButtonElement>('[data-act]');
      if (tool) {
        const id = tool.dataset.id!;
        const act = tool.dataset.act!;
        const sess = activeSession();
        const idx = sess.messages.findIndex(m => m.id === id);
        const m = sess.messages[idx];
        if (!m) return;
        if (act === 'copy') {
          navigator.clipboard?.writeText(m.content).then(() => setStatus('Copied'));
        } else if (act === 'speak') {
          speakOut(m.content);
        } else if (act === 'edit' && m.role === 'user') {
          input.value = m.content;
          updateInputUI();
          sess.messages = sess.messages.slice(0, idx);
          saveState();
          renderMessages();
          input.focus();
        } else if (act === 'retry' && m.role === 'assistant') {
          const userIdx = idx - 1;
          if (userIdx >= 0 && sess.messages[userIdx].role === 'user') {
            const userText = sess.messages[userIdx].content;
            sess.messages = sess.messages.slice(0, userIdx);
            saveState();
            renderMessages();
            send(userText);
          }
        } else if (act === 'critique' && m.role === 'assistant') {
          send(
            `Critique your prior reply ("${m.content.slice(0, 200).replace(/"/g, "'")}…") for: tightness, clarity, banned filler, accuracy, brand voice. Then rewrite it in 2-3 sentences.`
          );
        } else if (act === 'rewrite' && m.role === 'assistant') {
          send(`Rewrite your prior reply in a tighter style. Original:\n\n${m.content}`);
        } else if (act === 'branch' && m.role === 'assistant') {
          const fork = makeSession();
          fork.title = sess.title + ' (branch)';
          fork.messages = sess.messages.slice(0, idx + 1).map(x => ({ ...x }));
          state.sessions.unshift(fork);
          state.activeId = fork.id;
          saveState();
          renderSessions();
          renderMessages();
          setStatus('Branched to new chat');
        } else if (act === 'pin') {
          m.pinned = !m.pinned;
          saveState();
          renderMessages();
        } else if (act === 'like') {
          m.liked = m.liked === 1 ? 0 : 1;
          if (m.liked === 1 && state.settings.autoPinStars && !m.pinned) {
            m.pinned = true;
            const note = m.content.slice(0, 200);
            if (note && !state.settings.pinned.includes(note)) {
              state.settings.pinned.push(note);
            }
            setStatus('Liked + pinned');
          }
          saveState();
          renderMessages();
        } else if (act === 'expand') {
          const wrap = t.closest('.aichat__msg') as HTMLElement | null;
          if (wrap) {
            wrap.classList.remove('is-collapsed');
            wrap.querySelector('.aichat__msg-body')?.classList.remove('is-collapsed');
            const btn = wrap.querySelector('.aichat__msg-expand') as HTMLElement | null;
            if (btn) btn.remove();
          }
        }
        return;
      }
      const copyCode = t.closest<HTMLButtonElement>('[data-copycode]');
      if (copyCode) {
        const code = copyCode.parentElement?.querySelector('code')?.textContent || '';
        navigator.clipboard?.writeText(code).then(() => {
          copyCode.textContent = 'Copied';
          setTimeout(() => (copyCode.textContent = 'Copy'), 1200);
        });
        return;
      }
      const cmdBtn = t.closest<HTMLButtonElement>('[data-aichat-cmd]');
      if (cmdBtn) {
        const cmd = cmdBtn.dataset.aichatCmd;
        if (cmd) handleSlash('/' + cmd);
        return;
      }
      const sendBtn = t.closest<HTMLButtonElement>('[data-aichat-send]');
      if (sendBtn) {
        const text = sendBtn.dataset.aichatSend || sendBtn.textContent || '';
        if (text.trim()) send(text.trim());
        return;
      }
      const fbBtn = t.closest<HTMLButtonElement>('[data-aichat-feedback]');
      if (fbBtn) {
        const tone = fbBtn.dataset.aichatFeedback === 'up' ? 'up' : 'down';
        const row = fbBtn.parentElement;
        row?.querySelectorAll<HTMLButtonElement>('[data-aichat-feedback]').forEach(b => {
          b.disabled = true;
          b.classList.toggle('is-selected', b === fbBtn);
        });
        try {
          const rid = fbBtn.closest<HTMLElement>('[data-response-id]')?.dataset.responseId;
          window.dispatchEvent(new CustomEvent('aichat:feedback', { detail: { tone, responseId: rid } }));
        } catch {}
        setStatus(tone === 'up' ? 'Thanks for the feedback.' : 'Got it — noted.');
        return;
      }
    });

    messages.addEventListener('submit', async e => {
      const form = (e.target as HTMLElement)?.closest<HTMLFormElement>('[data-aichat-newsletter]');
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[name="email"]');
      const msg = form.querySelector<HTMLElement>('.aichat__w-newsletter-msg');
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const email = (input?.value || '').trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        if (msg) msg.textContent = 'Enter a valid email.';
        input?.focus();
        return;
      }
      if (btn) btn.disabled = true;
      if (msg) msg.textContent = 'Subscribing…';
      try {
        const list = form.dataset.aichatNewsletterList || '';
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(list ? { email, list } : { email })
        });
        if (res.ok) {
          if (msg) msg.textContent = 'Subscribed — check your inbox.';
          if (input) input.value = '';
          try {
            window.dispatchEvent(new CustomEvent('aichat:newsletter', { detail: { email, list } }));
          } catch {}
        } else {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          if (msg) msg.textContent = j?.error || 'Could not subscribe. Try again.';
        }
      } catch {
        if (msg) msg.textContent = 'Network error. Try again.';
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    composer.addEventListener('submit', e => {
      e.preventDefault();
      send(input.value);
    });

    input.addEventListener('input', () => {
      historyIdx = -1;
      updateInputUI();
      updateSuggest();
      updateMention();
    });
    input.addEventListener('keyup', () => updateMention());
    input.addEventListener('blur', () => {
      setTimeout(() => {
        mentionList = [];
        renderMention();
      }, 120);
    });
    input.addEventListener('keydown', e => {
      if (mentionList.length && !mention.hidden) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          mentionIdx = (mentionIdx + 1) % mentionList.length;
          renderMention();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          mentionIdx = (mentionIdx - 1 + mentionList.length) % mentionList.length;
          renderMention();
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          applyMention(mentionList[mentionIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          mentionList = [];
          renderMention();
          return;
        }
      }
      if (suggestList.length && !suggestBox.hidden) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          suggestIdx = (suggestIdx + 1) % suggestList.length;
          renderSuggest();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          suggestIdx = (suggestIdx - 1 + suggestList.length) % suggestList.length;
          renderSuggest();
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          applySuggest(suggestList[suggestIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          suggestList = [];
          renderSuggest();
          return;
        }
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && state.history.length) {
        if (input.value === '' || historyIdx >= 0) {
          e.preventDefault();
          if (historyIdx === -1) historyDraft = input.value;
          if (e.key === 'ArrowUp') historyIdx = Math.min(state.history.length - 1, historyIdx + 1);
          else historyIdx = Math.max(-1, historyIdx - 1);
          input.value =
            historyIdx === -1 ? historyDraft : state.history[state.history.length - 1 - historyIdx];
          updateInputUI();
          return;
        }
      }
      if (e.key === 'Enter' && state.settings.sendOnEnter && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(input.value);
      } else if (e.key === 'Enter' && !state.settings.sendOnEnter && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send(input.value);
      }
    });

    // Paste image / drag-drop attach
    composer.addEventListener('dragover', e => {
      e.preventDefault();
      composer.classList.add('is-dropping');
    });
    composer.addEventListener('dragleave', () => composer.classList.remove('is-dropping'));
    composer.addEventListener('drop', e => {
      e.preventDefault();
      composer.classList.remove('is-dropping');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) {
        attachedFiles.push(...files);
        renderAttachments();
      }
    });
    input.addEventListener('paste', e => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        attachedFiles.push(...files);
        renderAttachments();
      }
    });

    welcome.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(b => {
      b.addEventListener('click', () => {
        input.value = b.dataset.prompt!;
        updateInputUI();
        send(input.value);
      });
    });

    $('voice').addEventListener('click', () => toggleVoice());

    // ── Settings bindings ──────────────────────────────────────────────────
    tempSlider.addEventListener('input', () => {
      state.settings.temperature = Number(tempSlider.value);
      tempVal.textContent = state.settings.temperature.toFixed(2);
      saveState();
    });
    maxTokSlider.addEventListener('input', () => {
      state.settings.maxTokens = Number(maxTokSlider.value);
      maxTokVal.textContent = String(state.settings.maxTokens);
      saveState();
    });
    modelSelect.addEventListener('change', () => {
      state.settings.model = modelSelect.value;
      saveState();
    });
    systemArea.addEventListener('input', () => {
      state.settings.systemOverride = systemArea.value;
      saveState();
    });
    $('resetSystem').addEventListener('click', () => {
      state.settings.systemOverride = '';
      systemArea.value = '';
      saveState();
    });

    root.querySelector('[data-aichat="themeSwatch"]')!.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme]');
      if (!btn) return;
      state.settings.theme = btn.dataset.theme as Settings['theme'];
      saveState();
      applySettings();
    });
    root.querySelector('[data-aichat="densitySeg"]')!.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-density]');
      if (!btn) return;
      state.settings.density = btn.dataset.density as Settings['density'];
      saveState();
      applySettings();
    });

    ($('sendOnEnter') as HTMLInputElement).addEventListener('change', e => {
      state.settings.sendOnEnter = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('autoScroll') as HTMLInputElement).addEventListener('change', e => {
      state.settings.autoScroll = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('reactiveGlow') as HTMLInputElement).addEventListener('change', e => {
      state.settings.reactiveGlow = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    ($('sfx') as HTMLInputElement).addEventListener('change', e => {
      state.settings.sfx = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('wakeWord') as HTMLInputElement).addEventListener('change', e => {
      const on = (e.currentTarget as HTMLInputElement).checked;
      state.settings.wakeWord = on;
      saveState();
      if (on) startWakeWord();
      else stopWakeWord();
    });
    $<HTMLInputElement>('voiceRate').addEventListener('input', e => {
      const v = Number((e.currentTarget as HTMLInputElement).value);
      state.settings.voiceRate = v;
      $('voiceRateVal').textContent = v.toFixed(2);
      saveState();
    });

    personaSel.addEventListener('change', () => {
      state.settings.persona = personaSel.value as Persona;
      saveState();
      applySettings();
      setStatus(`Voice: ${PERSONAS[state.settings.persona].label}`);
    });

    ($('theatreMode') as HTMLInputElement).addEventListener('change', e => {
      state.settings.theatreMode = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    ($('spectrogramBackdrop') as HTMLInputElement).addEventListener('change', e => {
      state.settings.spectrogramBackdrop = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
      if (!state.settings.spectrogramBackdrop) {
        const c = spectro.getContext('2d');
        if (c) c.clearRect(0, 0, spectro.width, spectro.height);
      }
    });
    ($('beatSyncCaret') as HTMLInputElement).addEventListener('change', e => {
      state.settings.beatSyncCaret = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    ($('adaptiveDensity') as HTMLInputElement).addEventListener('change', e => {
      state.settings.adaptiveDensity = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
      renderMessages();
    });
    ($('showReadingTime') as HTMLInputElement).addEventListener('change', e => {
      state.settings.showReadingTime = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
      renderMessages();
    });
    ($('pttSpacebar') as HTMLInputElement).addEventListener('change', e => {
      state.settings.pttSpacebar = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('continuousDictation') as HTMLInputElement).addEventListener('change', e => {
      state.settings.continuousDictation = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('hideSpectroDuringStream') as HTMLInputElement).addEventListener('change', e => {
      state.settings.hideSpectroDuringStream = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    ($('collapseLongMessages') as HTMLInputElement).addEventListener('change', e => {
      state.settings.collapseLongMessages = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
      renderMessages();
    });
    ($('showTokenRate') as HTMLInputElement).addEventListener('change', e => {
      state.settings.showTokenRate = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    ($('autoPinStars') as HTMLInputElement).addEventListener('change', e => {
      state.settings.autoPinStars = (e.currentTarget as HTMLInputElement).checked;
      saveState();
    });
    ($('themeFromAlbum') as HTMLInputElement).addEventListener('change', e => {
      state.settings.themeFromAlbum = (e.currentTarget as HTMLInputElement).checked;
      saveState();
      applySettings();
    });
    $<HTMLInputElement>('autoSummarizeAt').addEventListener('input', e => {
      const v = Number((e.currentTarget as HTMLInputElement).value);
      state.settings.autoSummarizeAt = v;
      $('autoSummarizeAtVal').textContent = String(v);
      saveState();
    });

    if (quickbar) {
      quickbar.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-quick]');
        if (!btn) return;
        const prompt = btn.dataset.quick || btn.textContent || '';
        if (!prompt) return;
        input.value = prompt;
        updateInputUI();
        input.focus();
        send(prompt);
      });
    }
    if (continueBanner) {
      continueBanner.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        const close = target.closest<HTMLButtonElement>('[data-aichat="continueClose"]');
        const go = target.closest<HTMLButtonElement>('[data-aichat="continueGo"]');
        if (close) {
          continueBanner.hidden = true;
          return;
        }
        if (go) {
          continueBanner.hidden = true;
          send('Continue from exactly where you stopped — same voice, same thread.');
        }
      });
    }
    if (urlhint) {
      urlhint.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-urlplay]');
        if (!btn) return;
        const url = btn.dataset.urlplay || '';
        urlhint.hidden = true;
        if (url) window.open(url, '_blank', 'noopener');
      });
    }
    if (snipbar) {
      snipbar.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-snip]');
        if (!btn) return;
        const name = btn.dataset.snip || '';
        const text = state.settings.snippets?.[name];
        if (!text) return;
        const v = input.value;
        input.value = v.replace(/\/[a-zA-Z][\w-]{0,40}$/, text);
        updateInputUI();
        input.focus();
      });
    }

    $('poster').addEventListener('click', savePoster);
    $('cheatsheet').addEventListener('click', openCheat);
    $('cheatClose').addEventListener('click', closeCheat);
    sheetBackdrop.addEventListener('click', closeCheat);
    cheatBox.addEventListener('click', e => {
      if ((e.target as HTMLElement) === cheatBox) closeCheat();
    });

    ritual.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-aichat="ritualGo"]')) {
        sendRitualPrompt();
      } else if (t.closest('[data-aichat="ritualSkip"]')) {
        const today = new Date().toISOString().slice(0, 10);
        state.settings.dailyRitualSeenOn = today;
        saveState();
        ritual.hidden = true;
      }
    });

    pinsStrip.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const gPin = t.closest<HTMLButtonElement>('[data-pin-global]');
      const mPin = t.closest<HTMLButtonElement>('[data-pin-msg]');
      if (gPin) {
        const idx = Number(gPin.dataset.pinGlobal);
        const note = state.settings.pinned[idx];
        if (note) {
          input.value = (input.value ? input.value + ' ' : '') + note;
          updateInputUI();
          input.focus();
        }
      } else if (mPin) {
        const id = mPin.dataset.pinMsg!;
        const el = document.getElementById(`msg-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    $('notify').addEventListener('click', async () => {
      if (!('Notification' in window)) {
        setStatus('Notifications not supported');
        return;
      }
      const perm = await Notification.requestPermission();
      setStatus(perm === 'granted' ? 'Notifications on' : 'Notifications denied');
    });
    $('exportAll').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bz-chat-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('clearAll').addEventListener('click', () => {
      if (!confirm('Clear all chat conversations and settings? This cannot be undone.')) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      state = loadState();
      applySettings();
      renderMessages();
      renderSessions();
      setStatus('Cleared');
    });

    let resizing = false;
    let resizeStartX = 0;
    let startW = 0;
    resize.addEventListener('pointerdown', e => {
      resizing = true;
      resizeStartX = (e as PointerEvent).clientX;
      startW = panel.getBoundingClientRect().width;
      (resize as HTMLElement).setPointerCapture((e as PointerEvent).pointerId);
    });
    resize.addEventListener('pointermove', e => {
      if (!resizing) return;
      const dx = resizeStartX - (e as PointerEvent).clientX;
      const w = Math.max(320, Math.min(720, startW + dx));
      panel.style.setProperty('--aichat-w', `${w}px`);
      state.settings.width = w;
    });
    resize.addEventListener('pointerup', () => {
      resizing = false;
      saveState();
    });

    window.addEventListener('keydown', e => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setOpen(!panel.classList.contains('is-open'));
      }
      if (meta && e.key.toLowerCase() === 'f' && panel.classList.contains('is-open')) {
        e.preventDefault();
        if (msearch.hasAttribute('hidden')) openMsearch();
        else closeMsearch();
      }
      if (meta && e.key.toLowerCase() === '/' && panel.classList.contains('is-open')) {
        e.preventDefault();
        showSlashHelp();
      }
      if (meta && e.key.toLowerCase() === ',' && panel.classList.contains('is-open')) {
        e.preventDefault();
        const open = settingsPanel.classList.contains('is-open');
        sidebar.classList.remove('is-open');
        settingsPanel.classList.toggle('is-open', !open);
      }
      if (meta && e.key.toLowerCase() === 'e' && panel.classList.contains('is-open')) {
        e.preventDefault();
        exportSession(activeSession());
      }
      if (meta && e.key.toLowerCase() === 'l' && panel.classList.contains('is-open')) {
        e.preventDefault();
        activeSession().messages = [];
        saveState();
        renderMessages();
      }
      if (e.key === '?' && !meta && !e.altKey) {
        const t = e.target as HTMLElement;
        const inField =
          t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);
        if (!inField) {
          e.preventDefault();
          setOpen(true);
          showSlashHelp();
        }
      }
      if (e.key === 'Escape' && panel.classList.contains('is-open')) {
        if (!msearch.hasAttribute('hidden')) {
          closeMsearch();
          return;
        }
        if (sidebar.classList.contains('is-open')) {
          sidebar.classList.remove('is-open');
          return;
        }
        if (settingsPanel.classList.contains('is-open')) {
          settingsPanel.classList.remove('is-open');
          return;
        }
        setOpen(false);
      }
      if (meta && e.key.toLowerCase() === 'n' && panel.classList.contains('is-open')) {
        e.preventDefault();
        const s = makeSession();
        state.sessions.unshift(s);
        state.activeId = s.id;
        saveState();
        renderMessages();
        renderSessions();
      }
      if (meta && e.shiftKey && e.key === 'Enter' && panel.classList.contains('is-open')) {
        e.preventDefault();
        state.settings.theatreMode = !state.settings.theatreMode;
        saveState();
        applySettings();
        setStatus(`Theatre ${state.settings.theatreMode ? 'on' : 'off'}`);
      }
    });

    // Push-to-talk (hold spacebar when enabled and not in input)
    let pttActive = false;
    window.addEventListener('keydown', e => {
      if (!state.settings.pttSpacebar) return;
      if (e.key !== ' ' && e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inField) return;
      if (!panel.classList.contains('is-open')) return;
      if (pttActive || e.repeat) return;
      e.preventDefault();
      pttActive = true;
      if (!voiceRec) toggleVoice();
    });
    window.addEventListener('keyup', e => {
      if (!state.settings.pttSpacebar) return;
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!pttActive) return;
      pttActive = false;
      if (voiceRec) {
        voiceRec.stop();
        voiceRec = null;
        root.classList.remove('is-listening');
      }
      if (input.value.trim()) send(input.value);
    });

    window.addEventListener('online', () => setStatus('Ready'));
    window.addEventListener('offline', () => setStatus('Offline — chat needs a connection'));
  }

  function toggleVoice() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus('Voice not supported on this browser');
      return;
    }
    if (voiceRec) {
      voiceRec.stop();
      voiceRec = null;
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = !!state.settings.continuousDictation;
    rec.onresult = (e: SREvent) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      input.value = text;
      updateInputUI();
    };
    rec.onend = () => {
      voiceRec = null;
      root.classList.remove('is-listening');
    };
    rec.onerror = () => {
      voiceRec = null;
      root.classList.remove('is-listening');
    };
    rec.start();
    voiceRec = { stop: () => rec.stop() };
    root.classList.add('is-listening');
  }

  function speakOut(text: string) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ''));
    u.rate = state.settings.voiceRate;
    u.pitch = 1;
    speechSynthesis.speak(u);
  }

  applySettings();
  renderMessages();
  renderSessions();
  updateInputUI();
  bind();
  rafLoop();
  if (state.settings.wakeWord) queueMicrotask(() => startWakeWord());
}

interface SR extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
}
interface SREvent extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: { [i: number]: { transcript: string } } };
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SR;
    webkitSpeechRecognition?: new () => SR;
  }
}
