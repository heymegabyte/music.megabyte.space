import { describe, it, expect } from 'vitest';
import { serializeJsonLd } from './json-ld';

describe('serializeJsonLd', () => {
  it('round-trips plain objects identically to JSON.stringify', () => {
    const obj = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'bZ' };
    expect(serializeJsonLd(obj)).toBe(JSON.stringify(obj));
  });

  it('escapes </ sequences so a script-tag breakout cannot terminate the block', () => {
    const out = serializeJsonLd({ name: '</script><img onerror=alert(1)>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
  });

  it('escapes <!-- to avoid HTML comment parsing edge cases', () => {
    const out = serializeJsonLd({ name: '<!--comment-->' });
    expect(out).not.toContain('<!--');
    expect(out).toContain('\\u003c!--');
  });

  it('escapes U+2028 and U+2029 (legal in JSON, illegal in JS string literals)', () => {
    const out = serializeJsonLd({ name: 'a b c' });
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });

  it('preserves semantics — escaped output parses to the original value', () => {
    const original = {
      name: 'a</script>b<!--c d e',
      nested: { url: 'https://example.com/</script>' }
    };
    expect(JSON.parse(serializeJsonLd(original))).toEqual(original);
  });

  it('handles arrays of payloads', () => {
    const arr = [
      { '@type': 'WebSite' },
      { '@type': 'MusicRecording', name: '</script>x' }
    ];
    const out = serializeJsonLd(arr);
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)).toEqual(arr);
  });
});
