import { listBranches } from "./github";
import { getCachedBranchList, saveCachedBranchList } from "./storage";

/** Branches that always exist, in pipeline order. */
const FIXED_BRANCHES = [
  "staging-next",
  "master",
  "nixos-unstable-small",
  "nixpkgs-unstable",
  "nixos-unstable",
];

/** Used only when GitHub is unreachable and nothing is cached. */
const FALLBACK_STABLE = ["nixos-26.05"];

/** How many stable channels to offer (current + previous, for the overlap after a release). */
const STABLE_COUNT = 2;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SELECTION = ["nixos-unstable"];

const STABLE_RE = /^nixos-(\d{2})\.(\d{2})$/;

function stableVersion(branch: string): number {
  const m = branch.match(STABLE_RE);
  return m ? Number(m[1]) * 100 + Number(m[2]) : -1;
}

/** Newest stable channel branches (e.g. nixos-26.05), newest first. */
export function pickStableBranches(names: string[]): string[] {
  return names
    .filter((n) => STABLE_RE.test(n))
    .sort((a, b) => stableVersion(b) - stableVersion(a))
    .slice(0, STABLE_COUNT);
}

function withFixed(stable: string[]): string[] {
  return [...FIXED_BRANCHES, ...stable];
}

/** Branch list available synchronously: the cache (even if stale) or the fallback. */
export function initialBranches(): string[] {
  const cached = getCachedBranchList();
  return withFixed(cached?.branches ?? FALLBACK_STABLE);
}

/**
 * Fetches current stable branches if the cache is missing or stale.
 * Never throws: on failure it returns whatever `initialBranches` would.
 */
export async function refreshBranches(
  token: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const cached = getCachedBranchList();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return withFixed(cached.branches);
  }

  try {
    const stable = pickStableBranches(await listBranches("nixos-", token, signal));
    if (stable.length === 0) return initialBranches();
    saveCachedBranchList({ branches: stable, fetchedAt: Date.now() });
    return withFixed(stable);
  } catch {
    return initialBranches();
  }
}
