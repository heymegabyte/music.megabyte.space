import { describe, it, expect } from 'vitest';
import { escapeXmlText, escapeHtmlAttr } from './escape';

describe('escapeXmlText', () => {
  it('escapes ampersands first to avoid double-encoding', () => {
    expect(escapeXmlText('Pop & Rock')).toBe('Pop &amp; Rock');
    expect(escapeXmlText('&amp;')).toBe('&amp;amp;');
  });

  it('escapes angle brackets', () => {
    expect(escapeXmlText('<title>')).toBe('&lt;title&gt;');
  });

  it('leaves quotes and apostrophes untouched (legal in XML text content)', () => {
    expect(escapeXmlText(`"don't" said the bot`)).toBe(`"don't" said the bot`);
  });

  it('passes through unicode and emoji', () => {
    expect(escapeXmlText('Chef Lu — 🍲')).toBe('Chef Lu — 🍲');
  });

  it('is a no-op on empty string', () => {
    expect(escapeXmlText('')).toBe('');
  });
});

describe('escapeHtmlAttr', () => {
  it('escapes ampersands, angle brackets, both quote styles, and apostrophes', () => {
    expect(escapeHtmlAttr(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('orders ampersand escape first to avoid stacking', () => {
    expect(escapeHtmlAttr('&')).toBe('&amp;');
    expect(escapeHtmlAttr('&quot;')).toBe('&amp;quot;');
  });

  it('produces a string safe for embedding in title="..." attributes', () => {
    const dangerous = 'Foo " onload=alert(1) "';
    const escaped = escapeHtmlAttr(dangerous);
    expect(escaped).not.toContain('"');
    expect(escaped).toContain('&quot;');
  });

  it('passes through unicode', () => {
    expect(escapeHtmlAttr('Chef Lu — 🍲')).toBe('Chef Lu — 🍲');
  });
});
