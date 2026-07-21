import { describe, it, expect } from "vitest";
import { checkAllowlist } from "@/lib/images/allowlist";

describe("checkAllowlist", () => {
  it("accepts googleusercontent subdomains", () => {
    expect(checkAllowlist("https://lh3.googleusercontent.com/foo").ok).toBe(true);
    expect(checkAllowlist("https://lh5.googleusercontent.com/x/y").ok).toBe(true);
  });
  it("accepts exact hosts", () => {
    expect(checkAllowlist("https://maps.googleapis.com/api/place/photo?x=1").ok).toBe(true);
  });
  it("accepts ggpht.com suffix but not plain ggpht", () => {
    expect(checkAllowlist("https://foo.ggpht.com/x").ok).toBe(true);
    expect(checkAllowlist("https://ggpht.com/x").ok).toBe(false);
  });
  it("rejects lookalike suffix collisions (substring attack)", () => {
    expect(checkAllowlist("https://evilgoogleusercontent.com/x").ok).toBe(false);
    expect(checkAllowlist("https://googleusercontent.com.evil.tld/x").ok).toBe(false);
  });
  it("rejects IP literals", () => {
    expect(checkAllowlist("http://127.0.0.1/x").ok).toBe(false);
    expect(checkAllowlist("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkAllowlist("http://[::1]/x").ok).toBe(false);
  });
  it("rejects non-standard ports", () => {
    expect(checkAllowlist("https://lh3.googleusercontent.com:8080/x").ok).toBe(false);
  });
  it("rejects URL credentials", () => {
    expect(checkAllowlist("https://user:pass@lh3.googleusercontent.com/x").ok).toBe(false);
  });
  it("rejects non-http protocols", () => {
    expect(checkAllowlist("file:///etc/passwd").ok).toBe(false);
    expect(checkAllowlist("gopher://lh3.googleusercontent.com/x").ok).toBe(false);
  });
  it("rejects malformed URLs", () => {
    expect(checkAllowlist("not a url").ok).toBe(false);
  });
});
