/**
 * Typed, safe widget payloads the AI chat panel can render inline with text.
 *
 * The renderer never trusts inputs: every string is escaped, every URL is
 * validated, and unknown widget kinds fall through to a text card. Widgets
 * can be authored locally (slash commands) or returned by the worker as a
 * fenced ```aiwidgets <json>``` block (server emission is documented but not
 * required for this build).
 */

export type AiChatWidgetKind =
  | 'text-card'
  | 'cta'
  | 'link-card'
  | 'photo'
  | 'gallery'
  | 'track-card'
  | 'album-card'
  | 'pricing-card'
  | 'faq-accordion'
  | 'mini-table'
  | 'stat-card'
  | 'timeline'
  | 'command-palette'
  | 'related-pages'
  | 'citation'
  | 'status-badge'
  | 'alert'
  | 'code-snippet'
  | 'audio-card'
  | 'quick-reply'
  | 'progress'
  | 'feedback'
  | 'search-results'
  | 'breadcrumb'
  | 'chart'
  | 'person-card'
  | 'event-card'
  | 'carousel'
  | 'next-best-action'
  | 'before-after'
  | 'newsletter-signup'
  | 'checklist'
  | 'document-card'
  | 'comparison-table';

interface BaseWidget {
  id?: string;
}

export interface TextCardWidget extends BaseWidget {
  kind: 'text-card';
  title?: string;
  body: string;
}

export interface CtaWidget extends BaseWidget {
  kind: 'cta';
  title: string;
  body?: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export interface LinkCardWidget extends BaseWidget {
  kind: 'link-card';
  title: string;
  description?: string;
  href: string;
  badge?: string;
}

export interface PhotoWidget extends BaseWidget {
  kind: 'photo';
  src: string;
  alt: string;
  caption?: string;
  credit?: string;
}

export interface GalleryWidget extends BaseWidget {
  kind: 'gallery';
  title?: string;
  items: { src: string; alt: string; href?: string }[];
}

export interface TrackCardWidget extends BaseWidget {
  kind: 'track-card';
  trackId: string;
  title: string;
  album: string;
  vibe?: string;
  cover?: string;
  href: string;
}

export interface AlbumCardWidget extends BaseWidget {
  kind: 'album-card';
  albumId: string;
  name: string;
  tagline?: string;
  cover?: string;
  trackCount: number;
  href: string;
}

export interface PricingCardWidget extends BaseWidget {
  kind: 'pricing-card';
  tier: string;
  price: string;
  cadence?: string;
  features: string[];
  cta?: { label: string; href: string };
}

export interface FaqAccordionWidget extends BaseWidget {
  kind: 'faq-accordion';
  title?: string;
  items: { q: string; a: string }[];
}

export interface MiniTableWidget extends BaseWidget {
  kind: 'mini-table';
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface StatCardWidget extends BaseWidget {
  kind: 'stat-card';
  label: string;
  value: string;
  delta?: string;
  hint?: string;
}

export interface TimelineWidget extends BaseWidget {
  kind: 'timeline';
  title?: string;
  items: { when: string; title: string; body?: string }[];
}

export interface CommandPaletteWidget extends BaseWidget {
  kind: 'command-palette';
  title?: string;
  hint?: string;
  groups: {
    label: string;
    items: { cmd: string; sig?: string; desc: string }[];
  }[];
}

export interface RelatedPagesWidget extends BaseWidget {
  kind: 'related-pages';
  title?: string;
  items: { label: string; href: string; hint?: string }[];
}

export interface CitationWidget extends BaseWidget {
  kind: 'citation';
  sources: { label: string; href: string; quote?: string }[];
}

export interface StatusBadgeWidget extends BaseWidget {
  kind: 'status-badge';
  label: string;
  tone: 'ok' | 'warn' | 'err' | 'info';
}

export interface AlertWidget extends BaseWidget {
  kind: 'alert';
  tone: 'info' | 'success' | 'warn' | 'error';
  title: string;
  body?: string;
}

export interface CodeSnippetWidget extends BaseWidget {
  kind: 'code-snippet';
  lang?: string;
  filename?: string;
  code: string;
}

export interface AudioCardWidget extends BaseWidget {
  kind: 'audio-card';
  trackId: string;
  title: string;
  album?: string;
  cover?: string;
  href: string;
}

export interface QuickReplyWidget extends BaseWidget {
  kind: 'quick-reply';
  title?: string;
  prompt?: string;
  options: { label: string; send?: string; href?: string; cmd?: string }[];
}

export interface ProgressWidget extends BaseWidget {
  kind: 'progress';
  title?: string;
  label?: string;
  percent?: number;
  steps?: { label: string; state: 'done' | 'active' | 'todo' }[];
}

export interface FeedbackWidget extends BaseWidget {
  kind: 'feedback';
  title?: string;
  prompt?: string;
  responseId?: string;
}

export interface SearchResultsWidget extends BaseWidget {
  kind: 'search-results';
  query?: string;
  results: {
    title: string;
    href: string;
    snippet?: string;
    badge?: string;
  }[];
}

export interface BreadcrumbWidget extends BaseWidget {
  kind: 'breadcrumb';
  items: { label: string; href?: string }[];
}

export interface ChartWidget extends BaseWidget {
  kind: 'chart';
  title?: string;
  label?: string;
  series: number[];
  unit?: string;
  caption?: string;
  variant?: 'spark' | 'bar';
}

export interface PersonCardWidget extends BaseWidget {
  kind: 'person-card';
  name: string;
  role?: string;
  bio?: string;
  avatar?: string;
  links?: { label: string; href: string }[];
}

export interface EventCardWidget extends BaseWidget {
  kind: 'event-card';
  title: string;
  when: string;
  where?: string;
  body?: string;
  cover?: string;
  cta?: { label: string; href: string };
}

export interface CarouselWidget extends BaseWidget {
  kind: 'carousel';
  title?: string;
  items: { src: string; alt: string; caption?: string; href?: string }[];
}

export interface NextBestActionWidget extends BaseWidget {
  kind: 'next-best-action';
  title?: string;
  reason?: string;
  primary: { label: string; href?: string; cmd?: string; send?: string };
  secondary?: { label: string; href?: string; cmd?: string; send?: string };
}

export interface BeforeAfterWidget extends BaseWidget {
  kind: 'before-after';
  title?: string;
  before: { src: string; alt: string; label?: string };
  after: { src: string; alt: string; label?: string };
  caption?: string;
}

export interface NewsletterSignupWidget extends BaseWidget {
  kind: 'newsletter-signup';
  title?: string;
  prompt?: string;
  placeholder?: string;
  cta?: string;
  consent?: string;
  list?: string;
}

export interface ChecklistWidget extends BaseWidget {
  kind: 'checklist';
  title?: string;
  items: { label: string; done?: boolean; hint?: string }[];
}

export interface DocumentCardWidget extends BaseWidget {
  kind: 'document-card';
  title: string;
  description?: string;
  href: string;
  format?: string;
  size?: string;
}

export interface ComparisonTableWidget extends BaseWidget {
  kind: 'comparison-table';
  caption?: string;
  columns: string[];
  rows: { label: string; values: (string | boolean)[] }[];
  highlight?: number;
}

export type AiChatWidget =
  | TextCardWidget
  | CtaWidget
  | LinkCardWidget
  | PhotoWidget
  | GalleryWidget
  | TrackCardWidget
  | AlbumCardWidget
  | PricingCardWidget
  | FaqAccordionWidget
  | MiniTableWidget
  | StatCardWidget
  | TimelineWidget
  | CommandPaletteWidget
  | RelatedPagesWidget
  | CitationWidget
  | StatusBadgeWidget
  | AlertWidget
  | CodeSnippetWidget
  | AudioCardWidget
  | QuickReplyWidget
  | ProgressWidget
  | FeedbackWidget
  | SearchResultsWidget
  | BreadcrumbWidget
  | ChartWidget
  | PersonCardWidget
  | EventCardWidget
  | CarouselWidget
  | NextBestActionWidget
  | BeforeAfterWidget
  | NewsletterSignupWidget
  | ChecklistWidget
  | DocumentCardWidget
  | ComparisonTableWidget;

/**
 * The structured contract a worker response can emit. The client renders the
 * `text` field as markdown, then appends each widget below it. `metadata` is
 * surfaced via the tools bar (latency, model, requestId).
 */
export interface AiChatResponse {
  id: string;
  conversationId: string;
  role: 'assistant';
  text: string;
  widgets?: AiChatWidget[];
  suggestions?: string[];
  commands?: string[];
  sources?: { label: string; href: string }[];
  metadata?: {
    model?: string;
    latencyMs?: number;
    requestId?: string;
    confidence?: number;
  };
}

// ─── safe rendering ──────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

const SAFE_URL = /^(https?:|mailto:|tel:|\/[^/])/i;
const SAFE_PATH = /^\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]*$/;

/**
 * Accept absolute http(s)/mailto/tel/protocol-relative paths only. Reject
 * `javascript:`, `data:`, `file:`, blank-and-anything-else. Falls back to "#"
 * which renders the link inert.
 */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || !u) return '#';
  const trimmed = u.trim();
  if (trimmed.startsWith('//')) return '#';
  if (trimmed.startsWith('/')) return SAFE_PATH.test(trimmed) ? trimmed : '#';
  return SAFE_URL.test(trimmed) ? trimmed : '#';
}

function externalAttrs(href: string): string {
  return /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
}

function renderTextCard(w: TextCardWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  return `<section class="aichat__widget aichat__widget--text" role="group">${title}<p class="aichat__w-body">${escapeHtml(w.body)}</p></section>`;
}

function renderCta(w: CtaWidget): string {
  const body = w.body ? `<p class="aichat__w-body">${escapeHtml(w.body)}</p>` : '';
  const ph = safeUrl(w.primary.href);
  const sh = w.secondary ? safeUrl(w.secondary.href) : '';
  const sec = w.secondary
    ? `<a class="aichat__w-btn aichat__w-btn--ghost" href="${sh}"${externalAttrs(sh)}>${escapeHtml(w.secondary.label)}</a>`
    : '';
  return `<section class="aichat__widget aichat__widget--cta"><header class="aichat__w-title">${escapeHtml(w.title)}</header>${body}<div class="aichat__w-actions"><a class="aichat__w-btn" href="${ph}"${externalAttrs(ph)}>${escapeHtml(w.primary.label)}</a>${sec}</div></section>`;
}

function renderLinkCard(w: LinkCardWidget): string {
  const href = safeUrl(w.href);
  const desc = w.description ? `<p class="aichat__w-body">${escapeHtml(w.description)}</p>` : '';
  const badge = w.badge ? `<span class="aichat__w-badge">${escapeHtml(w.badge)}</span>` : '';
  return `<a class="aichat__widget aichat__widget--link" href="${href}"${externalAttrs(href)}>${badge}<header class="aichat__w-title">${escapeHtml(w.title)}</header>${desc}</a>`;
}

function renderPhoto(w: PhotoWidget): string {
  const src = safeUrl(w.src);
  const alt = escapeHtml(w.alt || '');
  const cap = w.caption ? `<figcaption>${escapeHtml(w.caption)}</figcaption>` : '';
  const credit = w.credit ? `<small class="aichat__w-credit">${escapeHtml(w.credit)}</small>` : '';
  return `<figure class="aichat__widget aichat__widget--photo"><img src="${src}" alt="${alt}" loading="lazy" decoding="async">${cap}${credit}</figure>`;
}

function renderGallery(w: GalleryWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const items = w.items
    .slice(0, 12)
    .map(it => {
      const src = safeUrl(it.src);
      const alt = escapeHtml(it.alt || '');
      const img = `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
      if (it.href) {
        const href = safeUrl(it.href);
        return `<a class="aichat__w-gallery-item" href="${href}"${externalAttrs(href)}>${img}</a>`;
      }
      return `<span class="aichat__w-gallery-item">${img}</span>`;
    })
    .join('');
  return `<section class="aichat__widget aichat__widget--gallery">${title}<div class="aichat__w-gallery">${items}</div></section>`;
}

function renderTrackCard(w: TrackCardWidget): string {
  const href = safeUrl(w.href);
  const cover = w.cover
    ? `<img class="aichat__w-cover" src="${safeUrl(w.cover)}" alt="${escapeHtml(w.title + ' cover art')}" loading="lazy" decoding="async">`
    : '';
  const vibe = w.vibe ? `<span class="aichat__w-vibe">${escapeHtml(w.vibe)}</span>` : '';
  return `<a class="aichat__widget aichat__widget--track" href="${href}"${externalAttrs(href)} data-track-id="${escapeHtml(w.trackId)}">${cover}<div class="aichat__w-track-meta"><header class="aichat__w-title">${escapeHtml(w.title)}</header><span class="aichat__w-album">${escapeHtml(w.album)}</span>${vibe}</div></a>`;
}

function renderAlbumCard(w: AlbumCardWidget): string {
  const href = safeUrl(w.href);
  const cover = w.cover
    ? `<img class="aichat__w-cover" src="${safeUrl(w.cover)}" alt="${escapeHtml(w.name + ' cover art')}" loading="lazy" decoding="async">`
    : '';
  const tag = w.tagline ? `<p class="aichat__w-body">${escapeHtml(w.tagline)}</p>` : '';
  return `<a class="aichat__widget aichat__widget--album" href="${href}"${externalAttrs(href)} data-album-id="${escapeHtml(w.albumId)}">${cover}<div class="aichat__w-album-meta"><header class="aichat__w-title">${escapeHtml(w.name)}</header>${tag}<small>${w.trackCount} tracks</small></div></a>`;
}

function renderPricingCard(w: PricingCardWidget): string {
  const cadence = w.cadence ? `<small class="aichat__w-cadence">${escapeHtml(w.cadence)}</small>` : '';
  const features = w.features
    .slice(0, 12)
    .map(f => `<li>${escapeHtml(f)}</li>`)
    .join('');
  const cta = w.cta
    ? `<a class="aichat__w-btn" href="${safeUrl(w.cta.href)}"${externalAttrs(safeUrl(w.cta.href))}>${escapeHtml(w.cta.label)}</a>`
    : '';
  return `<section class="aichat__widget aichat__widget--pricing"><header class="aichat__w-title">${escapeHtml(w.tier)}</header><strong class="aichat__w-price">${escapeHtml(w.price)}</strong>${cadence}<ul class="aichat__w-features">${features}</ul>${cta}</section>`;
}

function renderFaq(w: FaqAccordionWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const items = w.items
    .slice(0, 20)
    .map(
      it =>
        `<details class="aichat__w-faq-item"><summary>${escapeHtml(it.q)}</summary><p>${escapeHtml(it.a)}</p></details>`
    )
    .join('');
  return `<section class="aichat__widget aichat__widget--faq">${title}${items}</section>`;
}

function renderMiniTable(w: MiniTableWidget): string {
  const caption = w.caption ? `<caption>${escapeHtml(w.caption)}</caption>` : '';
  const head = w.headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const body = w.rows
    .slice(0, 50)
    .map(
      r =>
        `<tr>${r
          .slice(0, w.headers.length)
          .map(c => `<td>${escapeHtml(c)}</td>`)
          .join('')}</tr>`
    )
    .join('');
  return `<table class="aichat__widget aichat__widget--table">${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderStatCard(w: StatCardWidget): string {
  const delta = w.delta ? `<span class="aichat__w-delta">${escapeHtml(w.delta)}</span>` : '';
  const hint = w.hint ? `<small class="aichat__w-hint">${escapeHtml(w.hint)}</small>` : '';
  return `<section class="aichat__widget aichat__widget--stat"><span class="aichat__w-label">${escapeHtml(w.label)}</span><strong class="aichat__w-value">${escapeHtml(w.value)}</strong>${delta}${hint}</section>`;
}

function renderTimeline(w: TimelineWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const items = w.items
    .slice(0, 30)
    .map(
      it =>
        `<li><time>${escapeHtml(it.when)}</time><strong>${escapeHtml(it.title)}</strong>${it.body ? `<p>${escapeHtml(it.body)}</p>` : ''}</li>`
    )
    .join('');
  return `<section class="aichat__widget aichat__widget--timeline">${title}<ol>${items}</ol></section>`;
}

function renderCommandPalette(w: CommandPaletteWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const hint = w.hint ? `<p class="aichat__w-hint">${escapeHtml(w.hint)}</p>` : '';
  const groups = w.groups
    .map(g => {
      const items = g.items
        .map(it => {
          const sig = it.sig ? `<span class="aichat__w-cmd-sig">${escapeHtml(it.sig)}</span>` : '';
          return `<li><button type="button" class="aichat__w-cmd" data-aichat-cmd="${escapeHtml(it.cmd)}"><code>/${escapeHtml(it.cmd)}</code>${sig}<span class="aichat__w-cmd-desc">${escapeHtml(it.desc)}</span></button></li>`;
        })
        .join('');
      return `<section class="aichat__w-cmd-group"><h4>${escapeHtml(g.label)}</h4><ul>${items}</ul></section>`;
    })
    .join('');
  return `<section class="aichat__widget aichat__widget--palette" aria-label="Command palette">${title}${hint}${groups}</section>`;
}

function renderRelatedPages(w: RelatedPagesWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const items = w.items
    .slice(0, 12)
    .map(it => {
      const href = safeUrl(it.href);
      const hint = it.hint ? `<small>${escapeHtml(it.hint)}</small>` : '';
      return `<li><a href="${href}"${externalAttrs(href)}>${escapeHtml(it.label)}</a>${hint}</li>`;
    })
    .join('');
  return `<nav class="aichat__widget aichat__widget--related" aria-label="Related pages">${title}<ul>${items}</ul></nav>`;
}

function renderCitation(w: CitationWidget): string {
  const items = w.sources
    .slice(0, 12)
    .map((s, i) => {
      const href = safeUrl(s.href);
      const quote = s.quote ? `<blockquote>${escapeHtml(s.quote)}</blockquote>` : '';
      return `<li><sup>${i + 1}</sup> <a href="${href}"${externalAttrs(href)}>${escapeHtml(s.label)}</a>${quote}</li>`;
    })
    .join('');
  return `<aside class="aichat__widget aichat__widget--cite" aria-label="Sources"><h4>Sources</h4><ol>${items}</ol></aside>`;
}

function renderStatusBadge(w: StatusBadgeWidget): string {
  const tone = ['ok', 'warn', 'err', 'info'].includes(w.tone) ? w.tone : 'info';
  return `<span class="aichat__widget aichat__widget--badge aichat__widget--badge-${tone}" role="status">${escapeHtml(w.label)}</span>`;
}

function renderAlert(w: AlertWidget): string {
  const tone = ['info', 'success', 'warn', 'error'].includes(w.tone) ? w.tone : 'info';
  const body = w.body ? `<p class="aichat__w-body">${escapeHtml(w.body)}</p>` : '';
  const role = tone === 'error' || tone === 'warn' ? 'alert' : 'status';
  return `<aside class="aichat__widget aichat__widget--alert aichat__widget--alert-${tone}" role="${role}"><strong>${escapeHtml(w.title)}</strong>${body}</aside>`;
}

function renderCodeSnippet(w: CodeSnippetWidget): string {
  const lang = w.lang ? escapeHtml(w.lang) : '';
  const file = w.filename ? `<span class="aichat__w-filename">${escapeHtml(w.filename)}</span>` : '';
  return `<figure class="aichat__widget aichat__widget--code"><figcaption>${file}<span class="aichat__w-lang">${lang}</span><button type="button" class="aichat__copycode" data-copycode>Copy</button></figcaption><pre><code>${escapeHtml(w.code)}</code></pre></figure>`;
}

function renderAudioCard(w: AudioCardWidget): string {
  const href = safeUrl(w.href);
  const cover = w.cover
    ? `<img class="aichat__w-cover" src="${safeUrl(w.cover)}" alt="${escapeHtml(w.title + ' cover art')}" loading="lazy" decoding="async">`
    : '';
  const album = w.album ? `<span class="aichat__w-album">${escapeHtml(w.album)}</span>` : '';
  return `<a class="aichat__widget aichat__widget--audio" href="${href}"${externalAttrs(href)} data-track-id="${escapeHtml(w.trackId)}">${cover}<div class="aichat__w-audio-meta"><header class="aichat__w-title">${escapeHtml(w.title)}</header>${album}<span class="aichat__w-audio-play" aria-hidden="true">▶ Play</span></div></a>`;
}

function renderQuickReply(w: QuickReplyWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const prompt = w.prompt ? `<p class="aichat__w-body">${escapeHtml(w.prompt)}</p>` : '';
  const buttons = w.options
    .slice(0, 12)
    .map(opt => {
      const label = escapeHtml(opt.label);
      if (opt.href) {
        const href = safeUrl(opt.href);
        return `<a class="aichat__w-quick" href="${href}"${externalAttrs(href)}>${label}</a>`;
      }
      if (opt.cmd) {
        return `<button type="button" class="aichat__w-quick" data-aichat-cmd="${escapeHtml(opt.cmd)}">${label}</button>`;
      }
      const send = escapeHtml(opt.send ?? opt.label);
      return `<button type="button" class="aichat__w-quick" data-aichat-send="${send}">${label}</button>`;
    })
    .join('');
  return `<section class="aichat__widget aichat__widget--quickreply" role="group" aria-label="Quick replies">${title}${prompt}<div class="aichat__w-quick-row">${buttons}</div></section>`;
}

function renderProgress(w: ProgressWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const label = w.label ? `<span class="aichat__w-label">${escapeHtml(w.label)}</span>` : '';
  const pctRaw = typeof w.percent === 'number' ? w.percent : null;
  const pct = pctRaw === null ? null : Math.max(0, Math.min(100, Math.round(pctRaw)));
  const bar =
    pct !== null
      ? `<div class="aichat__w-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span><small>${pct}%</small></div>`
      : '';
  const steps =
    Array.isArray(w.steps) && w.steps.length
      ? `<ol class="aichat__w-progress-steps">${w.steps
          .slice(0, 12)
          .map(s => {
            const state = s.state === 'done' || s.state === 'active' || s.state === 'todo' ? s.state : 'todo';
            const icon = state === 'done' ? '✓' : state === 'active' ? '●' : '○';
            return `<li class="aichat__w-progress-step is-${state}"><span class="aichat__w-progress-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(s.label)}</span></li>`;
          })
          .join('')}</ol>`
      : '';
  return `<section class="aichat__widget aichat__widget--progress">${title}${label}${bar}${steps}</section>`;
}

function renderFeedback(w: FeedbackWidget): string {
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const prompt = w.prompt
    ? `<p class="aichat__w-body">${escapeHtml(w.prompt)}</p>`
    : `<p class="aichat__w-body">Was this answer useful?</p>`;
  const rid = w.responseId ? ` data-response-id="${escapeHtml(w.responseId)}"` : '';
  return `<section class="aichat__widget aichat__widget--feedback" role="group" aria-label="Feedback"${rid}>${title}${prompt}<div class="aichat__w-feedback-row"><button type="button" class="aichat__w-feedback-btn" data-aichat-feedback="up" aria-label="Thumbs up">👍 <span>Helpful</span></button><button type="button" class="aichat__w-feedback-btn" data-aichat-feedback="down" aria-label="Thumbs down">👎 <span>Not useful</span></button></div></section>`;
}

function renderSearchResults(w: SearchResultsWidget): string {
  const query = w.query
    ? `<header class="aichat__w-title">Results for <em>${escapeHtml(w.query)}</em></header>`
    : '';
  if (!Array.isArray(w.results) || !w.results.length) {
    return `<section class="aichat__widget aichat__widget--search">${query}<p class="aichat__w-body">No matches.</p></section>`;
  }
  const items = w.results
    .slice(0, 12)
    .map(r => {
      const href = safeUrl(r.href);
      const snippet = r.snippet ? `<p class="aichat__w-body">${escapeHtml(r.snippet)}</p>` : '';
      const badge = r.badge ? `<span class="aichat__w-badge">${escapeHtml(r.badge)}</span>` : '';
      return `<li><a href="${href}"${externalAttrs(href)}>${badge}<strong>${escapeHtml(r.title)}</strong>${snippet}</a></li>`;
    })
    .join('');
  return `<section class="aichat__widget aichat__widget--search" aria-label="Search results">${query}<ol>${items}</ol></section>`;
}

function renderBreadcrumb(w: BreadcrumbWidget): string {
  if (!Array.isArray(w.items) || !w.items.length) return '';
  const items = w.items
    .slice(0, 8)
    .map((it, i, arr) => {
      const label = escapeHtml(it.label);
      const isLast = i === arr.length - 1;
      const node =
        it.href && !isLast
          ? `<a href="${safeUrl(it.href)}"${externalAttrs(safeUrl(it.href))}>${label}</a>`
          : `<span aria-current="${isLast ? 'page' : 'false'}">${label}</span>`;
      const sep = isLast ? '' : '<span class="aichat__w-crumb-sep" aria-hidden="true">›</span>';
      return `<li>${node}${sep}</li>`;
    })
    .join('');
  return `<nav class="aichat__widget aichat__widget--breadcrumb" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

function renderChart(w: ChartWidget): string {
  const series = Array.isArray(w.series) ? w.series.filter(n => typeof n === 'number' && isFinite(n)) : [];
  if (!series.length) return '';
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = max - min || 1;
  const width = 200;
  const height = 60;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const variant = w.variant === 'bar' ? 'bar' : 'spark';
  let svg = '';
  if (variant === 'bar') {
    const bw = Math.max(2, Math.floor(width / series.length) - 2);
    svg = series
      .map((n, i) => {
        const h = ((n - min) / range) * (height - 4);
        const x = i * (width / series.length) + 1;
        const y = height - h - 1;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="1"></rect>`;
      })
      .join('');
  } else {
    const pts = series
      .map((n, i) => {
        const x = i * step;
        const y = height - ((n - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const lastX = (series.length - 1) * step;
    const lastY = height - ((series[series.length - 1] - min) / range) * (height - 4) - 2;
    svg = `<polyline points="${pts}" fill="none"></polyline><circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5"></circle>`;
  }
  const last = series[series.length - 1];
  const labelTxt = w.label ? escapeHtml(w.label) : '';
  const unit = w.unit ? escapeHtml(w.unit) : '';
  const value = `<strong class="aichat__w-chart-value">${last}${unit ? ` <small>${unit}</small>` : ''}</strong>`;
  const caption = w.caption ? `<small class="aichat__w-hint">${escapeHtml(w.caption)}</small>` : '';
  const label = labelTxt ? `<span class="aichat__w-label">${labelTxt}</span>` : '';
  return `<section class="aichat__widget aichat__widget--chart aichat__widget--chart-${variant}" aria-label="${labelTxt || 'Chart'}">${title}${label}${value}<svg class="aichat__w-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-hidden="true">${svg}</svg>${caption}</section>`;
}

function renderPersonCard(w: PersonCardWidget): string {
  const avatar = w.avatar
    ? `<img class="aichat__w-avatar" src="${safeUrl(w.avatar)}" alt="${escapeHtml(w.name)}" loading="lazy" decoding="async">`
    : `<span class="aichat__w-avatar aichat__w-avatar--initial" aria-hidden="true">${escapeHtml(w.name.charAt(0).toUpperCase())}</span>`;
  const role = w.role ? `<span class="aichat__w-role">${escapeHtml(w.role)}</span>` : '';
  const bio = w.bio ? `<p class="aichat__w-body">${escapeHtml(w.bio)}</p>` : '';
  const links =
    Array.isArray(w.links) && w.links.length
      ? `<div class="aichat__w-person-links">${w.links
          .slice(0, 6)
          .map(l => {
            const href = safeUrl(l.href);
            return `<a class="aichat__w-chip" href="${href}"${externalAttrs(href)}>${escapeHtml(l.label)}</a>`;
          })
          .join('')}</div>`
      : '';
  return `<article class="aichat__widget aichat__widget--person">${avatar}<div class="aichat__w-person-body"><header class="aichat__w-title">${escapeHtml(w.name)}</header>${role}${bio}${links}</div></article>`;
}

function renderEventCard(w: EventCardWidget): string {
  const cover = w.cover
    ? `<img class="aichat__w-cover" src="${safeUrl(w.cover)}" alt="${escapeHtml(w.title)}" loading="lazy" decoding="async">`
    : '';
  const where = w.where ? `<span class="aichat__w-event-where">${escapeHtml(w.where)}</span>` : '';
  const body = w.body ? `<p class="aichat__w-body">${escapeHtml(w.body)}</p>` : '';
  const cta = w.cta
    ? `<a class="aichat__w-btn" href="${safeUrl(w.cta.href)}"${externalAttrs(safeUrl(w.cta.href))}>${escapeHtml(w.cta.label)}</a>`
    : '';
  return `<article class="aichat__widget aichat__widget--event">${cover}<div class="aichat__w-event-meta"><time class="aichat__w-event-when">${escapeHtml(w.when)}</time><header class="aichat__w-title">${escapeHtml(w.title)}</header>${where}${body}${cta}</div></article>`;
}

function renderCarousel(w: CarouselWidget): string {
  if (!Array.isArray(w.items) || !w.items.length) return '';
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const items = w.items
    .slice(0, 12)
    .map(it => {
      const src = safeUrl(it.src);
      const alt = escapeHtml(it.alt || '');
      const cap = it.caption ? `<figcaption>${escapeHtml(it.caption)}</figcaption>` : '';
      const img = `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
      const inner = `<figure class="aichat__w-carousel-item">${img}${cap}</figure>`;
      if (it.href) {
        const href = safeUrl(it.href);
        return `<a class="aichat__w-carousel-link" href="${href}"${externalAttrs(href)}>${inner}</a>`;
      }
      return inner;
    })
    .join('');
  return `<section class="aichat__widget aichat__widget--carousel" aria-roledescription="carousel">${title}<div class="aichat__w-carousel-rail" tabindex="0" role="region" aria-label="${w.title ? escapeHtml(w.title) : 'Carousel'}">${items}</div></section>`;
}

function renderNextBestAction(w: NextBestActionWidget): string {
  const title = w.title
    ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>`
    : `<header class="aichat__w-title">Next best action</header>`;
  const reason = w.reason ? `<p class="aichat__w-body">${escapeHtml(w.reason)}</p>` : '';
  const renderBtn = (action: NextBestActionWidget['primary'], cls: string): string => {
    const label = escapeHtml(action.label);
    if (action.href) {
      const href = safeUrl(action.href);
      return `<a class="aichat__w-btn ${cls}" href="${href}"${externalAttrs(href)}>${label}</a>`;
    }
    if (action.cmd) {
      return `<button type="button" class="aichat__w-btn ${cls}" data-aichat-cmd="${escapeHtml(action.cmd)}">${label}</button>`;
    }
    const send = escapeHtml(action.send ?? action.label);
    return `<button type="button" class="aichat__w-btn ${cls}" data-aichat-send="${send}">${label}</button>`;
  };
  const prim = renderBtn(w.primary, '');
  const sec = w.secondary ? renderBtn(w.secondary, 'aichat__w-btn--ghost') : '';
  return `<section class="aichat__widget aichat__widget--nba" role="group" aria-label="Recommended action">${title}${reason}<div class="aichat__w-actions">${prim}${sec}</div></section>`;
}

function renderBeforeAfter(w: BeforeAfterWidget): string {
  if (!w.before?.src || !w.after?.src) return '';
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const caption = w.caption ? `<figcaption>${escapeHtml(w.caption)}</figcaption>` : '';
  const bSrc = safeUrl(w.before.src);
  const aSrc = safeUrl(w.after.src);
  const bAlt = escapeHtml(w.before.alt || 'Before');
  const aAlt = escapeHtml(w.after.alt || 'After');
  const bLbl = escapeHtml(w.before.label || 'Before');
  const aLbl = escapeHtml(w.after.label || 'After');
  return `<section class="aichat__widget aichat__widget--ba">${title}<figure class="aichat__w-ba-grid"><div class="aichat__w-ba-pane"><img src="${bSrc}" alt="${bAlt}" loading="lazy" decoding="async"><span class="aichat__w-ba-label">${bLbl}</span></div><div class="aichat__w-ba-pane"><img src="${aSrc}" alt="${aAlt}" loading="lazy" decoding="async"><span class="aichat__w-ba-label aichat__w-ba-label--after">${aLbl}</span></div>${caption}</figure></section>`;
}

function renderNewsletterSignup(w: NewsletterSignupWidget): string {
  const title = w.title
    ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>`
    : `<header class="aichat__w-title">Stay in the loop</header>`;
  const prompt = w.prompt ? `<p class="aichat__w-body">${escapeHtml(w.prompt)}</p>` : '';
  const placeholder = escapeHtml(w.placeholder || 'you@example.com');
  const cta = escapeHtml(w.cta || 'Subscribe');
  const consent = w.consent
    ? `<small class="aichat__w-newsletter-consent">${escapeHtml(w.consent)}</small>`
    : '';
  const list = w.list ? ` data-aichat-newsletter-list="${escapeHtml(w.list)}"` : '';
  return `<section class="aichat__widget aichat__widget--newsletter" role="group">${title}${prompt}<form class="aichat__w-newsletter-form" data-aichat-newsletter="1"${list} novalidate><label class="aichat__sr-only" for="aichat-newsletter-email">Email address</label><input id="aichat-newsletter-email" class="aichat__w-newsletter-input" type="email" name="email" autocomplete="email" placeholder="${placeholder}" required><button type="submit" class="aichat__w-btn aichat__w-newsletter-submit">${cta}</button><p class="aichat__w-newsletter-msg" role="status" aria-live="polite"></p>${consent}</form></section>`;
}

function renderChecklist(w: ChecklistWidget): string {
  if (!Array.isArray(w.items) || !w.items.length) return '';
  const title = w.title ? `<header class="aichat__w-title">${escapeHtml(w.title)}</header>` : '';
  const done = w.items.filter(i => i?.done).length;
  const total = w.items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const items = w.items
    .slice(0, 24)
    .map(it => {
      if (!it || typeof it.label !== 'string') return '';
      const isDone = !!it.done;
      const hint = it.hint ? `<span class="aichat__w-check-hint">${escapeHtml(it.hint)}</span>` : '';
      const icon = isDone ? '✓' : '○';
      return `<li class="aichat__w-check-item${isDone ? ' aichat__w-check-item--done' : ''}"><span class="aichat__w-check-icon" aria-hidden="true">${icon}</span><span class="aichat__w-check-label">${escapeHtml(it.label)}</span>${hint}</li>`;
    })
    .filter(Boolean)
    .join('');
  return `<section class="aichat__widget aichat__widget--checklist" role="group"><div class="aichat__w-check-head">${title}<span class="aichat__w-check-count">${done}/${total}</span></div><div class="aichat__w-check-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span class="aichat__w-check-bar-fill" style="width:${pct}%"></span></div><ul class="aichat__w-check-list">${items}</ul></section>`;
}

function renderDocumentCard(w: DocumentCardWidget): string {
  const href = safeUrl(w.href);
  const desc = w.description ? `<p class="aichat__w-body">${escapeHtml(w.description)}</p>` : '';
  const fmt = w.format ? `<span class="aichat__w-doc-fmt">${escapeHtml(w.format)}</span>` : '';
  const size = w.size ? `<span class="aichat__w-doc-size">${escapeHtml(w.size)}</span>` : '';
  const meta = fmt || size ? `<div class="aichat__w-doc-meta">${fmt}${size}</div>` : '';
  return `<a class="aichat__widget aichat__widget--doc" href="${href}"${externalAttrs(href)} role="group"><span class="aichat__w-doc-icon" aria-hidden="true">📄</span><div class="aichat__w-doc-body"><header class="aichat__w-title">${escapeHtml(w.title)}</header>${desc}${meta}</div></a>`;
}

function renderComparisonTable(w: ComparisonTableWidget): string {
  if (!Array.isArray(w.columns) || !w.columns.length) return '';
  if (!Array.isArray(w.rows) || !w.rows.length) return '';
  const caption = w.caption ? `<caption>${escapeHtml(w.caption)}</caption>` : '';
  const cols = w.columns.slice(0, 6);
  const head = cols
    .map((c, i) => {
      const cls = w.highlight === i ? ' class="aichat__w-cmp-hl"' : '';
      return `<th scope="col"${cls}>${escapeHtml(c)}</th>`;
    })
    .join('');
  const rows = w.rows
    .slice(0, 24)
    .map(r => {
      if (!r || typeof r.label !== 'string' || !Array.isArray(r.values)) return '';
      const cells = cols
        .map((_, i) => {
          const v = r.values[i];
          const hl = w.highlight === i ? ' class="aichat__w-cmp-hl"' : '';
          if (typeof v === 'boolean') {
            const mark = v ? '✓' : '—';
            const sr = v ? 'Yes' : 'No';
            return `<td${hl}><span aria-hidden="true">${mark}</span><span class="aichat__sr-only">${sr}</span></td>`;
          }
          return `<td${hl}>${escapeHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${escapeHtml(r.label)}</th>${cells}</tr>`;
    })
    .filter(Boolean)
    .join('');
  return `<section class="aichat__widget aichat__widget--cmp" role="group"><div class="aichat__w-cmp-scroll"><table class="aichat__w-cmp-table">${caption}<thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

/**
 * Render a single widget. Unknown kinds fall through to a text card carrying
 * the JSON shape so the user still sees something instead of a silent drop.
 */
export function renderWidget(w: unknown): string {
  if (!w || typeof w !== 'object' || !('kind' in w)) return '';
  const kind = (w as { kind: unknown }).kind;
  switch (kind) {
    case 'text-card':
      return renderTextCard(w as TextCardWidget);
    case 'cta':
      return renderCta(w as CtaWidget);
    case 'link-card':
      return renderLinkCard(w as LinkCardWidget);
    case 'photo':
      return renderPhoto(w as PhotoWidget);
    case 'gallery':
      return renderGallery(w as GalleryWidget);
    case 'track-card':
      return renderTrackCard(w as TrackCardWidget);
    case 'album-card':
      return renderAlbumCard(w as AlbumCardWidget);
    case 'pricing-card':
      return renderPricingCard(w as PricingCardWidget);
    case 'faq-accordion':
      return renderFaq(w as FaqAccordionWidget);
    case 'mini-table':
      return renderMiniTable(w as MiniTableWidget);
    case 'stat-card':
      return renderStatCard(w as StatCardWidget);
    case 'timeline':
      return renderTimeline(w as TimelineWidget);
    case 'command-palette':
      return renderCommandPalette(w as CommandPaletteWidget);
    case 'related-pages':
      return renderRelatedPages(w as RelatedPagesWidget);
    case 'citation':
      return renderCitation(w as CitationWidget);
    case 'status-badge':
      return renderStatusBadge(w as StatusBadgeWidget);
    case 'alert':
      return renderAlert(w as AlertWidget);
    case 'code-snippet':
      return renderCodeSnippet(w as CodeSnippetWidget);
    case 'audio-card':
      return renderAudioCard(w as AudioCardWidget);
    case 'quick-reply':
      return renderQuickReply(w as QuickReplyWidget);
    case 'progress':
      return renderProgress(w as ProgressWidget);
    case 'feedback':
      return renderFeedback(w as FeedbackWidget);
    case 'search-results':
      return renderSearchResults(w as SearchResultsWidget);
    case 'breadcrumb':
      return renderBreadcrumb(w as BreadcrumbWidget);
    case 'chart':
      return renderChart(w as ChartWidget);
    case 'person-card':
      return renderPersonCard(w as PersonCardWidget);
    case 'event-card':
      return renderEventCard(w as EventCardWidget);
    case 'carousel':
      return renderCarousel(w as CarouselWidget);
    case 'next-best-action':
      return renderNextBestAction(w as NextBestActionWidget);
    case 'before-after':
      return renderBeforeAfter(w as BeforeAfterWidget);
    case 'newsletter-signup':
      return renderNewsletterSignup(w as NewsletterSignupWidget);
    case 'checklist':
      return renderChecklist(w as ChecklistWidget);
    case 'document-card':
      return renderDocumentCard(w as DocumentCardWidget);
    case 'comparison-table':
      return renderComparisonTable(w as ComparisonTableWidget);
    default:
      return renderTextCard({
        kind: 'text-card',
        title: 'Unsupported widget',
        body: `Unknown widget kind: ${String(kind).slice(0, 80)}`
      });
  }
}

/**
 * Render a widget bundle below an assistant message. Returns an empty string
 * when there are no widgets so callers can append unconditionally.
 */
export function renderWidgets(widgets?: AiChatWidget[] | null): string {
  if (!Array.isArray(widgets) || !widgets.length) return '';
  const rendered = widgets.slice(0, 24).map(renderWidget).filter(Boolean).join('');
  return rendered ? `<div class="aichat__widgets" role="list">${rendered}</div>` : '';
}

const VALID_WIDGET_KINDS: ReadonlySet<string> = new Set([
  'text-card', 'cta', 'link-card', 'photo', 'gallery', 'track-card', 'album-card',
  'pricing-card', 'faq-accordion', 'mini-table', 'stat-card', 'timeline',
  'command-palette', 'related-pages', 'citation', 'status-badge', 'alert',
  'code-snippet', 'audio-card', 'quick-reply', 'progress', 'feedback',
  'search-results', 'breadcrumb', 'chart', 'person-card', 'event-card',
  'carousel', 'next-best-action', 'before-after', 'newsletter-signup',
  'checklist', 'document-card', 'comparison-table'
]);

/**
 * Strip ```aiwidgets``` fenced blocks from streamed assistant text. Each block
 * must contain a JSON array of widget objects; invalid JSON or unknown `kind`
 * values are dropped. Returns the cleaned markdown plus any widgets recovered.
 * Caps total widgets at 24 to mirror the renderer.
 */
export function parseAiWidgets(text: string): { text: string; widgets: AiChatWidget[] } {
  if (typeof text !== 'string' || !text.includes('aiwidgets')) {
    return { text, widgets: [] };
  }
  const widgets: AiChatWidget[] = [];
  const re = /```(?:aiwidgets|aiwidget)\s*\n([\s\S]*?)\n```/g;
  const cleaned = text.replace(re, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const w of arr) {
        if (
          w &&
          typeof w === 'object' &&
          typeof (w as { kind?: unknown }).kind === 'string' &&
          VALID_WIDGET_KINDS.has((w as { kind: string }).kind) &&
          widgets.length < 24
        ) {
          widgets.push(w as AiChatWidget);
        }
      }
    } catch {}
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), widgets };
}
