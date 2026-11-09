const API_BASE = "https://api.github.com/repos/NixOS/nixpkgs";
const GH_API_VERSION = "2022-11-28";

export type PRHeader = {
  title: string;
  closed: boolean;
  merged: boolean;
  base: string;
  mergeCommitSha: string | null;
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function authHeaders(token: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GH_API_VERSION,
  };
  if (token) {
    // Works for classic (ghp_) and fine-grained (github_pat_) tokens.
    headers.Authorization = token.startsWith("github_pat_")
      ? `Bearer ${token}`
      : `token ${token}`;
  }
  return headers;
}

async function fetchJSON<T>(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: authHeaders(token),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new HttpError(0, "Network error");
  }

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText || "Request failed",
    );
  }

  return response.json() as Promise<T>;
}

export async function getPRHeader(
  pr: string,
  token: string,
  signal?: AbortSignal,
): Promise<PRHeader> {
  const data = await fetchJSON<{
    title: string;
    state: string;
    merged_at: string | null;
    base: { ref: string };
    merge_commit_sha: string | null;
  }>(`${API_BASE}/pulls/${pr}`, token, signal);

  return {
    title: data.title,
    closed: data.state === "closed" && data.merged_at === null,
    merged: data.merged_at !== null,
    base: data.base.ref,
    mergeCommitSha: data.merge_commit_sha,
  };
}

/** True if `commitSha` is already contained in `branch`. */
export async function checkBranch(
  branch: string,
  commitSha: string,
  token: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const data = await fetchJSON<{ status: string }>(
    `${API_BASE}/compare/${encodeURIComponent(branch)}...${encodeURIComponent(commitSha)}`,
    token,
    signal,
  );
  return data.status === "identical" || data.status === "behind";
}

/** Names of all branches starting with `prefix` (unpaginated endpoint). */
export async function listBranches(
  prefix: string,
  token: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const data = await fetchJSON<{ ref: string }[]>(
    `${API_BASE}/git/matching-refs/heads/${encodeURIComponent(prefix)}`,
    token,
    signal,
  );
  return data.map((r) => r.ref.replace(/^refs\/heads\//, ""));
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 403 || err.status === 429) {
      return "API rate limit exceeded — set a GitHub token to increase the limit";
    }
    if (err.status === 404) return "PR not found";
    if (err.status === 401) return "Invalid GitHub token";
    if (err.status === 0) return "Network error — check your connection";
    return `Request failed (HTTP ${err.status})`;
  }
  if (isAbortError(err)) {
    return "";
  }
  return "Request failed — check the PR number or network";
}
