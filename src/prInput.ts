function canUseDOM(): boolean {
  return typeof window !== "undefined";
}

export function getPrFromURL(): string {
  if (!canUseDOM()) return "";
  return new URLSearchParams(window.location.search).get("pr") ?? "";
}

export function setPrToURL(pr: string) {
  if (!canUseDOM()) return;
  const url = new URL(window.location.href);
  if (pr) url.searchParams.set("pr", pr);
  else url.searchParams.delete("pr");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Accept bare numbers or GitHub PR URLs. */
export function parsePrInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const fromUrl = value.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i);
  if (fromUrl) return fromUrl[1];

  const bare = value.match(/^#?(\d+)$/);
  if (bare) return bare[1];

  return null;
}
