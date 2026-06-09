// Trusted Types compat shim.
//
// The actual `default` policy is installed by an inline `<script>` at the
// top of index.html / embed.html / cast-receiver/index.html (the *first*
// script in <head>, before Cloudflare's bot-management injects its iframe).
// That inline policy handles every innerHTML / script.src / script.text
// assignment in the document automatically via the special `default`
// policy name in the Trusted Types spec.
//
// This module exists only so call sites that want EXPLICIT TrustedScriptURL
// wrapping can do so without re-creating a policy (which would log a
// duplicate-policy CSP violation even though `trusted-types
// 'allow-duplicates'` permits it — Chrome report-only mode is noisy).
// The functions are passthrough — string in, string out — because the
// default policy already coerces them on assignment.

/** Identity-passthrough wrapper for explicit script.src assignments.
 *  No-op here; the inline HEAD default policy handles the real coercion. */
export function asScriptURL(url: string): string {
  return url;
}

/** Idempotent no-op kept for backwards compatibility with earlier imports. */
export function installDefaultTrustedTypesPolicy(): void {
  /* default policy is installed by the inline <head> script — nothing to do */
}
