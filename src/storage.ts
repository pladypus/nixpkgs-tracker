const LS_TOKEN = "nixpkgs_tracker_token";
const LS_BRANCHES = "nixpkgs_tracker_branches";
const LS_BRANCH_LIST = "nixpkgs_tracker_branch_list";

function canUseDOM(): boolean {
  return typeof window !== "undefined";
}

function readJSON(key: string): unknown {
  if (!canUseDOM()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  if (!canUseDOM()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked; the value just won't persist.
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function getToken(): string {
  if (!canUseDOM()) return "";
  return localStorage.getItem(LS_TOKEN) ?? "";
}

export function setStoredToken(token: string) {
  if (!canUseDOM()) return;
  if (token) localStorage.setItem(LS_TOKEN, token);
  else localStorage.removeItem(LS_TOKEN);
}

/**
 * The user's ticked branches. Entries that are no longer offered are kept,
 * so a selection survives until the branch list catches up.
 */
export function getSavedSelection(): string[] | null {
  const parsed = readJSON(LS_BRANCHES);
  return isStringArray(parsed) && parsed.length > 0 ? parsed : null;
}

export function saveSelection(branches: Set<string>) {
  writeJSON(LS_BRANCHES, [...branches]);
}

export type CachedBranchList = { branches: string[]; fetchedAt: number };

export function getCachedBranchList(): CachedBranchList | null {
  const parsed = readJSON(LS_BRANCH_LIST);
  if (
    parsed &&
    typeof parsed === "object" &&
    "branches" in parsed &&
    "fetchedAt" in parsed &&
    isStringArray(parsed.branches) &&
    typeof parsed.fetchedAt === "number"
  ) {
    return { branches: parsed.branches, fetchedAt: parsed.fetchedAt };
  }
  return null;
}

export function saveCachedBranchList(list: CachedBranchList) {
  writeJSON(LS_BRANCH_LIST, list);
}
