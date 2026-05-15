// Context-aware escape helpers for the edge worker's HTML/XML output.
//
// HTMLRewriter's `setInnerContent(s)` (without `{html: true}`) already
// HTML-escapes its argument, so passing pre-escaped text double-encodes.
// `escapeXmlText` is for places where we build raw markup ourselves
// (oEmbed XML response). `escapeHtmlAttr` is for HTML attribute values
// inside hand-built strings (oEmbed iframe `title=`).

export const escapeXmlText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const escapeHtmlAttr = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
