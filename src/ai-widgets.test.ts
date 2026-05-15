import { describe, expect, it } from 'vitest';
import { escapeHtml, renderWidget, renderWidgets, safeUrl, type AiChatWidget } from './ai-widgets';

describe('escapeHtml', () => {
  it('escapes the five entity characters', () => {
    expect(escapeHtml(`<script>alert("x&y'z")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;'
    );
  });

  it('returns the empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('safeUrl', () => {
  it('allows http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/foo?bar=1')).toBe('https://example.com/foo?bar=1');
  });

  it('allows mailto and tel', () => {
    expect(safeUrl('mailto:hey@megabyte.space')).toBe('mailto:hey@megabyte.space');
    expect(safeUrl('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('allows site-relative paths', () => {
    expect(safeUrl('/canopy/birch-swing-heaven')).toBe('/canopy/birch-swing-heaven');
  });

  it('rejects javascript:, data:, file:, blob:', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('JavaScript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>x</script>')).toBe('#');
    expect(safeUrl('file:///etc/passwd')).toBe('#');
    expect(safeUrl('blob:https://example.com/abc')).toBe('#');
  });

  it('rejects non-strings', () => {
    expect(safeUrl(null)).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
    expect(safeUrl(42)).toBe('#');
    expect(safeUrl({ href: 'https://example.com' })).toBe('#');
  });

  it('rejects protocol-relative URLs (//evil.com) which would silently inherit scheme', () => {
    expect(safeUrl('//evil.com/x')).toBe('#');
  });
});

describe('renderWidget — text-card', () => {
  it('escapes user-provided title and body', () => {
    const html = renderWidget({
      kind: 'text-card',
      title: '<b>bold</b>',
      body: '"hi" & <em>bye</em>'
    });
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&quot;hi&quot; &amp; &lt;em&gt;bye&lt;/em&gt;');
    expect(html).toContain('class="aichat__widget aichat__widget--text"');
  });

  it('omits the header when no title', () => {
    const html = renderWidget({ kind: 'text-card', body: 'hello' });
    expect(html).not.toContain('aichat__w-title');
    expect(html).toContain('hello');
  });
});

describe('renderWidget — cta', () => {
  it('renders primary + optional secondary buttons with safe hrefs', () => {
    const html = renderWidget({
      kind: 'cta',
      title: 'Listen now',
      body: 'Two albums dropped.',
      primary: { label: 'Play', href: 'https://music.megabyte.space/canopy/birch-swing-heaven' },
      secondary: { label: 'About', href: '/about' }
    });
    expect(html).toContain('href="https://music.megabyte.space/canopy/birch-swing-heaven"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Play');
    expect(html).toContain('About');
  });

  it('neutralizes javascript: hrefs to "#"', () => {
    const html = renderWidget({
      kind: 'cta',
      title: 'Pwn',
      primary: { label: 'click', href: 'javascript:steal()' }
    });
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });
});

describe('renderWidget — link-card', () => {
  it('renders title, description, badge and external rel attrs', () => {
    const html = renderWidget({
      kind: 'link-card',
      title: 'Read the prose',
      description: 'Long-form notes on the album.',
      href: 'https://example.com/prose',
      badge: 'NEW'
    });
    expect(html).toContain('Read the prose');
    expect(html).toContain('Long-form notes on the album.');
    expect(html).toContain('NEW');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('renderWidget — photo', () => {
  it('always renders an alt attribute (empty allowed)', () => {
    const html = renderWidget({
      kind: 'photo',
      src: 'https://example.com/x.png',
      alt: ''
    });
    expect(html).toContain('alt=""');
    expect(html).toContain('loading="lazy"');
  });

  it('escapes caption + credit', () => {
    const html = renderWidget({
      kind: 'photo',
      src: '/art/cover.png',
      alt: 'Cover',
      caption: '<i>note</i>',
      credit: 'Photo & Co'
    });
    expect(html).toContain('&lt;i&gt;note&lt;/i&gt;');
    expect(html).toContain('Photo &amp; Co');
  });
});

describe('renderWidget — gallery', () => {
  it('caps at 12 items and renders alt on every image', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      src: `/art/${i}.png`,
      alt: `art ${i}`
    }));
    const html = renderWidget({ kind: 'gallery', items });
    const imgCount = (html.match(/<img/g) || []).length;
    expect(imgCount).toBe(12);
    expect(html).toContain('alt="art 0"');
  });
});

describe('renderWidget — track-card', () => {
  it('embeds trackId + href and escapes the title', () => {
    const html = renderWidget({
      kind: 'track-card',
      trackId: 'birch-swing-heaven',
      title: 'Touch The Sky',
      album: 'Canopy Dispatch',
      vibe: 'gospel hustle',
      cover: '/art/cover-canopy-dispatch.png',
      href: '/canopy/birch-swing-heaven'
    });
    expect(html).toContain('data-track-id="birch-swing-heaven"');
    expect(html).toContain('href="/canopy/birch-swing-heaven"');
    expect(html).toContain('Touch The Sky');
    expect(html).toContain('gospel hustle');
  });
});

describe('renderWidget — album-card', () => {
  it('renders name, tagline, and trackCount', () => {
    const html = renderWidget({
      kind: 'album-card',
      albumId: 'canopy-dispatch',
      name: 'Canopy Dispatch',
      tagline: 'A tree-line transmission',
      cover: '/art/cover-canopy-dispatch.png',
      trackCount: 9,
      href: '/canopy-dispatch'
    });
    expect(html).toContain('Canopy Dispatch');
    expect(html).toContain('A tree-line transmission');
    expect(html).toContain('9 tracks');
  });
});

describe('renderWidget — mini-table', () => {
  it('caps body cells to header length', () => {
    const html = renderWidget({
      kind: 'mini-table',
      caption: 'Albums',
      headers: ['Name', 'Year'],
      rows: [['Canopy Dispatch', '2026', 'extra-ignored']]
    });
    expect(html).toContain('<caption>Albums</caption>');
    expect(html).toContain('Canopy Dispatch');
    expect(html).toContain('2026');
    expect(html).not.toContain('extra-ignored');
  });
});

describe('renderWidget — command-palette', () => {
  it('renders grouped, clickable commands with data attribute', () => {
    const html = renderWidget({
      kind: 'command-palette',
      title: 'Shortcommands',
      hint: 'Click to run',
      groups: [
        {
          label: 'Chat',
          items: [
            { cmd: 'help', desc: 'show commands' },
            { cmd: 'clear', desc: 'wipe chat' }
          ]
        },
        {
          label: 'Playback',
          items: [{ cmd: 'play', desc: 'resume' }]
        }
      ]
    });
    expect(html).toContain('data-aichat-cmd="help"');
    expect(html).toContain('data-aichat-cmd="clear"');
    expect(html).toContain('data-aichat-cmd="play"');
    expect(html).toContain('Shortcommands');
    expect(html).toContain('<h4>Chat</h4>');
    expect(html).toContain('<h4>Playback</h4>');
  });
});

describe('renderWidget — citation', () => {
  it('numbers sources and escapes quotes', () => {
    const html = renderWidget({
      kind: 'citation',
      sources: [
        { label: 'Source A', href: 'https://a.example' },
        { label: 'Source B', href: 'https://b.example', quote: '<bad>quote</bad>' }
      ]
    });
    expect(html).toContain('<sup>1</sup>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('Source A');
    expect(html).toContain('&lt;bad&gt;quote&lt;/bad&gt;');
  });
});

describe('renderWidget — alert + status-badge tone clamping', () => {
  it('falls back to info tone on bad tone strings', () => {
    const alert = renderWidget({
      kind: 'alert',
      tone: 'evil' as unknown as 'info',
      title: 'Hey'
    });
    expect(alert).toContain('aichat__widget--alert-info');

    const badge = renderWidget({
      kind: 'status-badge',
      label: 'OK',
      tone: 'xyz' as unknown as 'ok'
    });
    expect(badge).toContain('aichat__widget--badge-info');
  });

  it('uses role=alert for error/warn alerts, role=status otherwise', () => {
    expect(renderWidget({ kind: 'alert', tone: 'error', title: 'Bad' })).toContain('role="alert"');
    expect(renderWidget({ kind: 'alert', tone: 'success', title: 'Good' })).toContain('role="status"');
  });
});

describe('renderWidget — code-snippet', () => {
  it('escapes the code body', () => {
    const html = renderWidget({
      kind: 'code-snippet',
      lang: 'ts',
      filename: 'example.ts',
      code: '<script>alert("x")</script>'
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('example.ts');
    expect(html).toContain('aichat__copycode');
  });
});

describe('renderWidget — quick-reply', () => {
  it('renders send/cmd/href options with proper data attributes', () => {
    const html = renderWidget({
      kind: 'quick-reply',
      title: 'Pick one',
      prompt: 'How can I help?',
      options: [
        { label: 'Show pricing', send: 'show me pricing' },
        { label: 'Help', cmd: 'help' },
        { label: 'Docs', href: 'https://example.com/docs' }
      ]
    });
    expect(html).toContain('data-aichat-send="show me pricing"');
    expect(html).toContain('data-aichat-cmd="help"');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Pick one');
  });

  it('escapes hostile option labels and rejects javascript: hrefs', () => {
    const html = renderWidget({
      kind: 'quick-reply',
      options: [
        { label: '<img onerror=x>', send: '<x>' },
        { label: 'Bad', href: 'javascript:alert(1)' }
      ]
    });
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(html).toContain('data-aichat-send="&lt;x&gt;"');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('caps options at 12', () => {
    const options = Array.from({ length: 20 }, (_, i) => ({ label: `Opt ${i}`, send: `s${i}` }));
    const html = renderWidget({ kind: 'quick-reply', options });
    expect((html.match(/data-aichat-send=/g) || []).length).toBe(12);
  });
});

describe('renderWidget — progress', () => {
  it('clamps percent between 0 and 100 and rounds', () => {
    const lo = renderWidget({ kind: 'progress', percent: -42 });
    const hi = renderWidget({ kind: 'progress', percent: 142.7 });
    const mid = renderWidget({ kind: 'progress', percent: 33.3 });
    expect(lo).toContain('aria-valuenow="0"');
    expect(hi).toContain('aria-valuenow="100"');
    expect(mid).toContain('aria-valuenow="33"');
    expect(mid).toContain('33%');
  });

  it('renders steps with state classes and escapes labels', () => {
    const html = renderWidget({
      kind: 'progress',
      title: 'Onboarding',
      steps: [
        { label: 'Sign up', state: 'done' },
        { label: '<x>configure</x>', state: 'active' },
        { label: 'Launch', state: 'todo' }
      ]
    });
    expect(html).toContain('aichat__w-progress-step is-done');
    expect(html).toContain('aichat__w-progress-step is-active');
    expect(html).toContain('aichat__w-progress-step is-todo');
    expect(html).toContain('&lt;x&gt;configure&lt;/x&gt;');
  });

  it('falls back to a safe state for invalid step state strings', () => {
    const html = renderWidget({
      kind: 'progress',
      steps: [{ label: 'A', state: 'evil' as unknown as 'done' }]
    });
    expect(html).toContain('aichat__w-progress-step is-todo');
  });
});

describe('renderWidget — feedback', () => {
  it('renders up + down buttons with response id', () => {
    const html = renderWidget({
      kind: 'feedback',
      title: 'How was that?',
      responseId: 'r-42'
    });
    expect(html).toContain('data-aichat-feedback="up"');
    expect(html).toContain('data-aichat-feedback="down"');
    expect(html).toContain('data-response-id="r-42"');
    expect(html).toContain('aria-label="Feedback"');
  });

  it('escapes the response id and prompt', () => {
    const html = renderWidget({
      kind: 'feedback',
      prompt: '<script>x</script>',
      responseId: '"><img>'
    });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('data-response-id="&quot;&gt;&lt;img&gt;"');
  });

  it('uses a default prompt when none is provided', () => {
    const html = renderWidget({ kind: 'feedback' });
    expect(html).toContain('Was this answer useful?');
  });
});

describe('renderWidget — search-results', () => {
  it('renders titles, snippets, badges, and safe hrefs', () => {
    const html = renderWidget({
      kind: 'search-results',
      query: 'birch',
      results: [
        {
          title: 'Birch Swing Heaven',
          href: '/canopy/birch-swing-heaven',
          snippet: 'A gospel-hustle anthem.',
          badge: 'Track'
        },
        { title: 'Canopy Dispatch', href: 'https://example.com/album' }
      ]
    });
    expect(html).toContain('Results for <em>birch</em>');
    expect(html).toContain('Birch Swing Heaven');
    expect(html).toContain('A gospel-hustle anthem.');
    expect(html).toContain('Track');
    expect(html).toContain('href="/canopy/birch-swing-heaven"');
    expect(html).toContain('target="_blank"');
  });

  it('renders a helpful empty state', () => {
    const html = renderWidget({ kind: 'search-results', query: 'nothing', results: [] });
    expect(html).toContain('No matches.');
  });

  it('caps at 12 results and rejects javascript: hrefs', () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      title: `Result ${i}`,
      href: i === 0 ? 'javascript:alert(1)' : `/r/${i}`
    }));
    const html = renderWidget({ kind: 'search-results', results });
    expect((html.match(/<li>/g) || []).length).toBe(12);
    expect(html).not.toContain('javascript:');
  });
});

describe('renderWidget — breadcrumb', () => {
  it('renders intermediate links and marks the last item current', () => {
    const html = renderWidget({
      kind: 'breadcrumb',
      items: [
        { label: 'Home', href: '/' },
        { label: 'Albums', href: '/albums' },
        { label: 'Canopy Dispatch' }
      ]
    });
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/albums"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Canopy Dispatch');
  });

  it('escapes hostile labels', () => {
    const html = renderWidget({
      kind: 'breadcrumb',
      items: [{ label: '<x>Home</x>', href: '/' }, { label: 'End' }]
    });
    expect(html).toContain('&lt;x&gt;Home&lt;/x&gt;');
  });

  it('returns empty string for empty items', () => {
    expect(renderWidget({ kind: 'breadcrumb', items: [] })).toBe('');
  });
});

describe('renderWidget — chart', () => {
  it('renders a sparkline svg with last value and label', () => {
    const html = renderWidget({
      kind: 'chart',
      title: 'Plays this week',
      label: 'Daily',
      series: [10, 20, 15, 30, 25, 40, 35],
      unit: 'plays'
    });
    expect(html).toContain('aichat__widget--chart');
    expect(html).toContain('aichat__widget--chart-spark');
    expect(html).toContain('<polyline');
    expect(html).toContain('<circle');
    expect(html).toContain('Plays this week');
    expect(html).toContain('Daily');
    expect(html).toContain('35');
    expect(html).toContain('plays');
  });

  it('renders bar variant with rect bars', () => {
    const html = renderWidget({
      kind: 'chart',
      series: [1, 2, 3, 4],
      variant: 'bar'
    });
    expect(html).toContain('aichat__widget--chart-bar');
    expect(html.match(/<rect/g)?.length).toBe(4);
    expect(html).not.toContain('<polyline');
  });

  it('escapes hostile title/label/unit + filters NaN from series', () => {
    const html = renderWidget({
      kind: 'chart',
      title: '<img src=x>',
      label: '"alpha"',
      series: [1, NaN, 2, Infinity, 3],
      unit: '<x>'
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&quot;alpha&quot;');
    expect(html).toContain('&lt;x&gt;');
  });

  it('returns empty string when series is empty or non-numeric', () => {
    expect(renderWidget({ kind: 'chart', series: [] })).toBe('');
    expect(renderWidget({ kind: 'chart', series: ['x', 'y'] as unknown as number[] })).toBe('');
  });
});

describe('renderWidget — person-card', () => {
  it('renders avatar img + name + role + bio + safe links', () => {
    const html = renderWidget({
      kind: 'person-card',
      name: 'Brian Zalewski',
      role: 'Founder',
      bio: 'Builds Megabyte Labs.',
      avatar: 'https://example.com/bz.jpg',
      links: [
        { label: 'GitHub', href: 'https://github.com/bz' },
        { label: 'Bad', href: 'javascript:alert(1)' }
      ]
    });
    expect(html).toContain('aichat__widget--person');
    expect(html).toContain('src="https://example.com/bz.jpg"');
    expect(html).toContain('Brian Zalewski');
    expect(html).toContain('Founder');
    expect(html).toContain('GitHub');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('falls back to initial when no avatar', () => {
    const html = renderWidget({ kind: 'person-card', name: 'Mira' });
    expect(html).toContain('aichat__w-avatar--initial');
    expect(html).toContain('>M<');
  });

  it('escapes hostile name', () => {
    const html = renderWidget({ kind: 'person-card', name: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderWidget — event-card', () => {
  it('renders when/where/title/body/cta', () => {
    const html = renderWidget({
      kind: 'event-card',
      title: 'Studio Session',
      when: '2026-06-01 7pm',
      where: 'Brooklyn',
      body: 'Open mic.',
      cta: { label: 'RSVP', href: 'https://example.com/rsvp' }
    });
    expect(html).toContain('aichat__widget--event');
    expect(html).toContain('<time');
    expect(html).toContain('2026-06-01 7pm');
    expect(html).toContain('Studio Session');
    expect(html).toContain('Brooklyn');
    expect(html).toContain('href="https://example.com/rsvp"');
    expect(html).toContain('target="_blank"');
  });

  it('omits cta and cover when absent', () => {
    const html = renderWidget({ kind: 'event-card', title: 'Solo', when: 'TBD' });
    expect(html).toContain('aichat__widget--event');
    expect(html).not.toContain('aichat__w-btn');
    expect(html).not.toContain('aichat__w-cover');
  });

  it('escapes hostile fields + sanitizes cta href', () => {
    const html = renderWidget({
      kind: 'event-card',
      title: '<b>x</b>',
      when: '"now"',
      cta: { label: 'Go', href: 'javascript:1' }
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&quot;now&quot;');
    expect(html).toContain('href="#"');
  });
});

describe('renderWidget — carousel', () => {
  it('renders a horizontal rail of figures with safe images', () => {
    const html = renderWidget({
      kind: 'carousel',
      title: 'Tour photos',
      items: [
        { src: 'https://example.com/a.jpg', alt: 'A', caption: 'NYC' },
        { src: 'https://example.com/b.jpg', alt: 'B', href: 'https://example.com/b' }
      ]
    });
    expect(html).toContain('aichat__widget--carousel');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('alt="A"');
    expect(html).toContain('alt="B"');
    expect(html).toContain('<figcaption>NYC</figcaption>');
    expect(html).toContain('href="https://example.com/b"');
  });

  it('caps at 12 items', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      src: `https://example.com/${i}.jpg`,
      alt: `n${i}`
    }));
    const html = renderWidget({ kind: 'carousel', items });
    expect(html.match(/<img /g)?.length).toBe(12);
  });

  it('returns empty when no items', () => {
    expect(renderWidget({ kind: 'carousel', items: [] })).toBe('');
  });
});

describe('renderWidget — next-best-action', () => {
  it('renders primary href button + ghost secondary send button', () => {
    const html = renderWidget({
      kind: 'next-best-action',
      title: 'Try the karaoke',
      reason: 'You liked Atlantis Crossfire.',
      primary: { label: 'Open Karaoke', href: '/canopy/karaoke' },
      secondary: { label: 'Tell me more', send: 'Explain karaoke mode' }
    });
    expect(html).toContain('aichat__widget--nba');
    expect(html).toContain('Try the karaoke');
    expect(html).toContain('href="/canopy/karaoke"');
    expect(html).toContain('data-aichat-send="Explain karaoke mode"');
    expect(html).toContain('aichat__w-btn--ghost');
  });

  it('renders primary cmd button when cmd is supplied', () => {
    const html = renderWidget({
      kind: 'next-best-action',
      primary: { label: 'Show stats', cmd: 'stats' }
    });
    expect(html).toContain('data-aichat-cmd="stats"');
    expect(html).toContain('Next best action');
  });

  it('escapes hostile labels + sanitizes hrefs', () => {
    const html = renderWidget({
      kind: 'next-best-action',
      title: '<x>',
      primary: { label: '<bad>', href: 'javascript:1' }
    });
    expect(html).not.toContain('<x>');
    expect(html).not.toContain('<bad>');
    expect(html).toContain('href="#"');
  });
});

describe('renderWidget — before-after', () => {
  it('renders both panes with labels and caption', () => {
    const html = renderWidget({
      kind: 'before-after',
      title: 'Mix v1 → v2',
      before: { src: '/img/v1.jpg', alt: 'v1 waveform', label: 'V1' },
      after: { src: '/img/v2.jpg', alt: 'v2 waveform', label: 'V2' },
      caption: 'Side-chain compression added.'
    });
    expect(html).toContain('aichat__widget--ba');
    expect(html).toContain('Mix v1 → v2');
    expect(html).toContain('src="/img/v1.jpg"');
    expect(html).toContain('src="/img/v2.jpg"');
    expect(html).toContain('alt="v1 waveform"');
    expect(html).toContain('>V1<');
    expect(html).toContain('>V2<');
    expect(html).toContain('Side-chain compression added.');
  });

  it('falls back to default labels and rejects javascript: URLs', () => {
    const html = renderWidget({
      kind: 'before-after',
      before: { src: 'javascript:alert(1)', alt: 'b' },
      after: { src: 'https://e.com/a.jpg', alt: 'a' }
    });
    expect(html).toContain('aichat__widget--ba');
    expect(html).toContain('>Before<');
    expect(html).toContain('>After<');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="#"');
  });

  it('returns empty string when a pane is missing src', () => {
    const html = renderWidget({
      kind: 'before-after',
      before: { src: '', alt: 'x' },
      after: { src: '/a.jpg', alt: 'a' }
    });
    expect(html).toBe('');
  });
});

describe('renderWidget — newsletter-signup', () => {
  it('renders a form with email input, hook attribute, and live status region', () => {
    const html = renderWidget({
      kind: 'newsletter-signup',
      title: 'Subscribe to drops',
      prompt: 'New tracks twice a month.',
      placeholder: 'you@yard.com',
      cta: 'Join',
      list: 'drops'
    });
    expect(html).toContain('aichat__widget--newsletter');
    expect(html).toContain('Subscribe to drops');
    expect(html).toContain('New tracks twice a month.');
    expect(html).toContain('data-aichat-newsletter="1"');
    expect(html).toContain('data-aichat-newsletter-list="drops"');
    expect(html).toContain('placeholder="you@yard.com"');
    expect(html).toContain('type="email"');
    expect(html).toContain('autocomplete="email"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('>Join<');
  });

  it('escapes consent text and prompt HTML', () => {
    const html = renderWidget({
      kind: 'newsletter-signup',
      prompt: '<script>x</script>',
      consent: 'By <b>signing</b> you agree.'
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('By &lt;b&gt;signing&lt;/b&gt; you agree.');
  });

  it('provides default title and CTA when absent', () => {
    const html = renderWidget({ kind: 'newsletter-signup' });
    expect(html).toContain('Stay in the loop');
    expect(html).toContain('>Subscribe<');
  });
});

describe('renderWidget — checklist', () => {
  it('renders items with progress bar and count', () => {
    const html = renderWidget({
      kind: 'checklist',
      title: 'Ship checklist',
      items: [
        { label: 'Master', done: true },
        { label: 'Cover art', done: true },
        { label: 'Upload', done: false, hint: 'Distrokid' }
      ]
    });
    expect(html).toContain('aichat__widget--checklist');
    expect(html).toContain('Ship checklist');
    expect(html).toContain('>2/3<');
    expect(html).toContain('aria-valuenow="67"');
    expect(html).toContain('aichat__w-check-item--done');
    expect(html).toContain('Distrokid');
  });

  it('escapes hostile labels and ignores non-string entries', () => {
    const html = renderWidget({
      kind: 'checklist',
      items: [
        { label: '<img onerror="x">', done: false },
        { label: 42 as unknown as string, done: false },
        { label: 'Final mix', done: true }
      ]
    });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;');
    expect(html).toContain('Final mix');
    expect(html).toContain('>1/3<');
  });

  it('returns empty string when items array is empty', () => {
    expect(renderWidget({ kind: 'checklist', items: [] })).toBe('');
  });
});

describe('renderWidget — document-card', () => {
  it('renders title, description, format, size and a sane link target', () => {
    const html = renderWidget({
      kind: 'document-card',
      title: 'Press kit',
      description: 'High-res photos + bio.',
      href: 'https://music.megabyte.space/press-kit.pdf',
      format: 'PDF',
      size: '2.4 MB'
    });
    expect(html).toContain('aichat__widget--doc');
    expect(html).toContain('href="https://music.megabyte.space/press-kit.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Press kit');
    expect(html).toContain('High-res photos + bio.');
    expect(html).toContain('PDF');
    expect(html).toContain('2.4 MB');
  });

  it('rejects javascript: hrefs and escapes hostile titles', () => {
    const html = renderWidget({
      kind: 'document-card',
      title: '<x>bad</x>',
      href: 'javascript:alert(1)'
    });
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<x>bad</x>');
    expect(html).toContain('&lt;x&gt;bad&lt;/x&gt;');
  });
});

describe('renderWidget — comparison-table', () => {
  it('renders a caption, header row, body rows, and boolean check cells', () => {
    const html = renderWidget({
      kind: 'comparison-table',
      caption: 'Plans',
      columns: ['Free', 'Pro'],
      rows: [
        { label: 'Tracks', values: ['10', '∞'] },
        { label: 'Lossless', values: [false, true] }
      ],
      highlight: 1
    });
    expect(html).toContain('aichat__widget--cmp');
    expect(html).toContain('<caption>Plans</caption>');
    expect(html).toContain('Free');
    expect(html).toContain('Pro');
    expect(html).toContain('Tracks');
    expect(html).toContain('Lossless');
    expect(html).toContain('>10<');
    expect(html).toContain('aichat__w-cmp-hl');
    expect(html).toContain('>✓<');
    expect(html).toContain('>—<');
    expect(html).toContain('class="aichat__sr-only">Yes<');
    expect(html).toContain('class="aichat__sr-only">No<');
  });

  it('escapes hostile column and cell content', () => {
    const html = renderWidget({
      kind: 'comparison-table',
      columns: ['<x>'],
      rows: [{ label: '<y>', values: ['<z>'] }]
    });
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('&lt;y&gt;');
    expect(html).toContain('&lt;z&gt;');
  });

  it('returns empty string when columns or rows are empty', () => {
    expect(renderWidget({ kind: 'comparison-table', columns: [], rows: [] })).toBe('');
    expect(
      renderWidget({
        kind: 'comparison-table',
        columns: ['A'],
        rows: []
      })
    ).toBe('');
  });
});

describe('renderWidget — unsupported / malformed', () => {
  it('renders an explanatory text card for unknown kinds', () => {
    const html = renderWidget({ kind: 'martian-spaceship', body: 'x' } as unknown);
    expect(html).toContain('Unsupported widget');
    expect(html).toContain('Unknown widget kind: martian-spaceship');
  });

  it('returns an empty string for non-object inputs', () => {
    expect(renderWidget(null)).toBe('');
    expect(renderWidget(undefined)).toBe('');
    expect(renderWidget('hello' as unknown)).toBe('');
    expect(renderWidget(42 as unknown)).toBe('');
  });
});

describe('renderWidgets bundle', () => {
  it('returns empty string for null/empty', () => {
    expect(renderWidgets(undefined)).toBe('');
    expect(renderWidgets(null)).toBe('');
    expect(renderWidgets([])).toBe('');
  });

  it('wraps multiple widgets in a list container', () => {
    const widgets: AiChatWidget[] = [
      { kind: 'text-card', body: 'a' },
      { kind: 'text-card', body: 'b' }
    ];
    const html = renderWidgets(widgets);
    expect(html.startsWith('<div class="aichat__widgets"')).toBe(true);
    expect(html.match(/aichat__widget--text/g)?.length).toBe(2);
  });

  it('caps at 24 widgets', () => {
    const widgets = Array.from(
      { length: 50 },
      (_, i) => ({ kind: 'text-card', body: `w${i}` }) as AiChatWidget
    );
    const html = renderWidgets(widgets);
    expect((html.match(/aichat__widget--text/g) || []).length).toBe(24);
  });
});
