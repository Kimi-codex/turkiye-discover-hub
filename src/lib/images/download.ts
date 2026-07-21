/**
 * SSRF-safe remote image download.
 * Enforced:
 *   - allowlist per Correction #3
 *   - manual redirect follow, allowlist re-checked at each hop (max 3)
 *   - size cap
 *   - request timeout
 *   - magic-byte validation
 */

import { checkAllowlist } from "./allowlist";
import { sniffImageType, type SniffedType } from "./magic-bytes";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB hard cap
const TIMEOUT_MS = 15_000;

export type DownloadErrorCode =
  | "URL_NOT_ALLOWED"
  | "REDIRECT_NOT_ALLOWED"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "UNSUPPORTED_TYPE"
  | "EMPTY_BODY";

export interface DownloadOk {
  ok: true;
  bytes: Uint8Array;
  contentType: SniffedType;
  finalUrl: string;
  hops: number;
}
export interface DownloadErr {
  ok: false;
  code: DownloadErrorCode;
  detail?: string;
}
export type DownloadResult = DownloadOk | DownloadErr;

export async function downloadImage(rawUrl: string): Promise<DownloadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let currentUrl = rawUrl;
    let hops = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const allow = checkAllowlist(currentUrl);
      if (!allow.ok) {
        return {
          ok: false,
          code: hops === 0 ? "URL_NOT_ALLOWED" : "REDIRECT_NOT_ALLOWED",
          detail: allow.reason,
        };
      }

      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "turkey-directory-image-worker/1.0" },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, code: "HTTP_ERROR", detail: `${res.status} no location` };
        hops++;
        if (hops > MAX_REDIRECTS) return { ok: false, code: "TOO_MANY_REDIRECTS" };
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      if (!res.ok) return { ok: false, code: "HTTP_ERROR", detail: String(res.status) };

      const cl = Number(res.headers.get("content-length") ?? 0);
      if (cl && cl > MAX_BYTES) return { ok: false, code: "TOO_LARGE" };

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) return { ok: false, code: "EMPTY_BODY" };
      if (buf.length > MAX_BYTES) return { ok: false, code: "TOO_LARGE" };

      const sniffed = sniffImageType(buf);
      if (sniffed === "unknown") return { ok: false, code: "UNSUPPORTED_TYPE" };

      return { ok: true, bytes: buf, contentType: sniffed, finalUrl: currentUrl, hops };
    }
  } catch (e) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    return { ok: false, code: isAbort ? "TIMEOUT" : "HTTP_ERROR", detail: String(e) };
  } finally {
    clearTimeout(timeout);
  }
}
