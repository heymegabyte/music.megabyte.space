// Defensive JSON serializer for `<script type="application/ld+json">` blocks.
//
// JSON.stringify happily emits the literal substring `</script>` if a track
// title (or any other string) contains it, which would terminate the script
// element and create an HTML/JS injection seam. Same applies to `<!--`
// (sequences that confuse the HTML parser) and the lone Unicode line
// terminators U+2028 / U+2029 (invisible to JSON but treated as line
// breaks by older JS engines).
//
// Today every JSON-LD payload is built from curated `src/data.ts`, so the
// risk is theoretical — but the escape is one regex and the test surface
// is tiny. Cheap defense-in-depth.

// RegExp built via constructor + Unicode escapes so the source file stays
// ASCII outside of comments — embedding raw U+2028 / U+2029 in a regex
// literal trips esbuild.
const UNSAFE = new RegExp('</|<!--|\\u2028|\\u2029', 'g');

/**
 * Serialize a JSON-LD payload to a string safe for direct embedding inside
 * `<script type="application/ld+json">…</script>`. The output is still
 * valid JSON and parses identically — every escape is a `\\uXXXX` form
 * that JSON.parse turns back into the original character.
 */
export function serializeJsonLd(value: unknown): string {
  // Every replacement is also a valid JSON escape sequence so JSON.parse
  // round-trips the output back to the original payload.
  return JSON.stringify(value).replace(UNSAFE, ch => {
    if (ch === '</') return '\\u003c/';
    if (ch === '<!--') return '\\u003c!--';
    if (ch === '\u2028') return '\\u2028';
    if (ch === '\u2029') return '\\u2029';
    return ch;
  });
}
