/**
 * Same-origin return paths only (task 03, open-redirect prevention):
 * absolute URLs, protocol-relative `//host`, and backslash tricks fall
 * back to the library root. Only in-app paths beginning with `/` pass.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw) return "/library"
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/library"
  }
  return raw
}
