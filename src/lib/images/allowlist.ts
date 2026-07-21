/**
 * Strict source-host allowlist for remote image downloads (SSRF guard).
 *
 * Correction #3: NO substring matching. Exact host or safe suffix only.
 * Correction #12: reject IP literals, non-standard ports, URL credentials.
 *
 * Hosts here are derived from actual Phase 3 Google Places import fixtures.
 * Add new hosts only after verification.
 */

const ALLOWED_EXACT = new Set<string>([
  "googleusercontent.com",
  "streetviewpixels-pa.googleapis.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
]);

const ALLOWED_SUFFIXES: string[] = [
  ".googleusercontent.com", // lh3, lh4, lh5, lh6, geo0, ...
  ".ggpht.com",             // Google user content CDN
];

const ALLOWED_PORTS = new Set(["", "80", "443"]);

export interface AllowlistResult {
  ok: boolean;
  reason?: string;
  host?: string;
}

/** Normalize + validate a URL string against the allowlist. */
export function checkAllowlist(rawUrl: string): AllowlistResult {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "bad_protocol" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "url_credentials" };
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    return { ok: false, reason: "port_not_allowed" };
  }
  const host = u.hostname.toLowerCase();
  if (isIpLiteral(host)) {
    return { ok: false, reason: "ip_literal" };
  }
  if (ALLOWED_EXACT.has(host)) return { ok: true, host };
  for (const suffix of ALLOWED_SUFFIXES) {
    if (host.endsWith(suffix)) return { ok: true, host };
  }
  return { ok: false, reason: "host_not_allowlisted", host };
}

function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (bracketless — URL parser strips brackets on hostname)
  if (host.includes(":")) return true;
  return false;
}
