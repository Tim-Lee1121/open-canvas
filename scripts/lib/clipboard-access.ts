import { randomBytes } from "node:crypto";

export const PAIRING_TTL_MS = 5 * 60_000;

export function isTrustedClipboardWrite(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host || !/^(?:localhost|127\.0\.0\.1):\d+$/i.test(host)) return false;
  return origin === `http://${host}`;
}

export function createClipboardPairingStore(now = () => Date.now()) {
  let entry: { code: string; html: string; expiresAt: number } | null = null;
  return {
    issue(html: string): string {
      const code = randomBytes(16).toString("hex");
      entry = { code, html, expiresAt: now() + PAIRING_TTL_MS };
      return code;
    },
    consume(code: string | undefined): string | null {
      if (!entry || !code || entry.expiresAt <= now() || entry.code !== code) return null;
      const html = entry.html;
      entry = null;
      return html;
    },
  };
}
