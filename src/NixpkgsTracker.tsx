import { toPng } from "html-to-image";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { DEFAULT_SELECTION, initialBranches, refreshBranches } from "./branches";
import { checkBranch, errorMessage, getPRHeader, isAbortError } from "./github";
import { getPrFromURL, parsePrInput, setPrToURL } from "./prInput";
import {
  getSavedSelection,
  getToken,
  saveSelection,
  setStoredToken,
} from "./storage";
import "./NixpkgsTracker.css";

type BranchStatus = {
  name: string;
  merged: boolean;
  checking: boolean;
  error?: boolean;
};

function toggleBranch(set: Set<string>, branch: string): Set<string> {
  const next = new Set(set);
  if (next.has(branch)) next.delete(branch);
  else next.add(branch);
  return next;
}

export function NixpkgsTracker() {
  const [prInput, setPrInput] = createSignal(getPrFromURL());
  const [selectedBranches, setSelectedBranches] = createSignal(
    new Set(getSavedSelection() ?? DEFAULT_SELECTION),
  );
  const [availableBranches, setAvailableBranches] = createSignal(
    initialBranches(),
  );
  const [token, setToken] = createSignal(getToken());
  const [showToken, setShowToken] = createSignal(false);

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [copyError, setCopyError] = createSignal("");

  const [prTitle, setPrTitle] = createSignal("");
  const [prNumber, setPrNumber] = createSignal("");
  const [prClosed, setPrClosed] = createSignal(false);
  const [prMerged, setPrMerged] = createSignal(false);
  const [prBase, setPrBase] = createSignal("");
  const [branchStatuses, setBranchStatuses] = createSignal<BranchStatus[]>([]);
  const [copied, setCopied] = createSignal(false);

  let resultCardRef: HTMLDivElement | undefined;
  let activeController: AbortController | null = null;
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  let branchesReady: Promise<string[]> | null = null;

  const isRelease = createMemo(() => prBase().startsWith("release-"));

  const mergedCount = createMemo(
    () => branchStatuses().filter((b) => b.merged).length,
  );

  onCleanup(() => {
    activeController?.abort();
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  function handleToggleBranch(branch: string) {
    setSelectedBranches((prev) => {
      const next = toggleBranch(prev, branch);
      saveSelection(next);
      return next;
    });
  }

  function saveToken(t: string) {
    const next = t.trim();
    setStoredToken(next);
    setToken(next);
  }

  function clearToken() {
    setStoredToken("");
    setToken("");
  }

  /** Starts the branch-list refresh once; later calls share the same promise. */
  function ensureBranches(): Promise<string[]> {
    branchesReady ??= refreshBranches(token()).then((list) => {
      setAvailableBranches(list);
      return list;
    });
    return branchesReady;
  }

  async function handleCheck() {
    const prNum = parsePrInput(prInput());
    if (!prNum) {
      setError("Enter a valid PR number or GitHub pull request URL");
      return;
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    setPrInput(prNum);
    setPrToURL(prNum);
    setPrNumber(prNum);
    setLoading(true);
    setError("");
    setCopyError("");
    setPrTitle("");
    setPrClosed(false);
    setPrMerged(false);
    setPrBase("");
    setBranchStatuses([]);

    try {
      const header = await getPRHeader(prNum, token(), controller.signal);

      if (controller.signal.aborted) return;

      setPrTitle(header.title);
      setPrClosed(header.closed);
      setPrMerged(header.merged);
      setPrBase(header.base);

      if (!header.merged) {
        setError(
          header.closed
            ? "This PR is closed and not merged"
            : "This PR is not merged yet",
        );
        setLoading(false);
        return;
      }

      if (!header.mergeCommitSha) {
        setError("PR is merged but merge commit SHA is missing");
        setLoading(false);
        return;
      }

      let branches: string[];
      if (header.base.startsWith("release-")) {
        branches = [header.base];
      } else {
        const available = await ensureBranches();
        if (controller.signal.aborted) return;
        branches = available.filter((b) => selectedBranches().has(b));
      }

      if (branches.length === 0) {
        setError("Select at least one branch to check");
        setLoading(false);
        return;
      }

      setBranchStatuses(
        branches.map((b) => ({ name: b, merged: false, checking: true })),
      );

      await Promise.all(
        branches.map(async (b) => {
          try {
            const merged = await checkBranch(
              b,
              header.mergeCommitSha!,
              token(),
              controller.signal,
            );
            if (controller.signal.aborted) return;
            setBranchStatuses((prev) =>
              prev.map((s) =>
                s.name === b ? { name: b, merged, checking: false } : s,
              ),
            );
          } catch (err) {
            if (isAbortError(err)) return;
            if (controller.signal.aborted) return;
            setBranchStatuses((prev) =>
              prev.map((s) =>
                s.name === b
                  ? { name: b, merged: false, checking: false, error: true }
                  : s,
              ),
            );
          }
        }),
      );
    } catch (err) {
      if (isAbortError(err)) return;
      const message = errorMessage(err);
      if (message) setError(message);
    } finally {
      if (activeController === controller) {
        activeController = null;
        setLoading(false);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleCheck();
    }
  }

  async function handleCopyImage() {
    if (!resultCardRef || !prTitle()) return;
    setCopyError("");
    try {
      const dataUrl = await toPng(resultCardRef, {
        cacheBust: true,
        pixelRatio: 2,
        // Match the current theme so the image looks like the card on screen.
        backgroundColor: getComputedStyle(resultCardRef).backgroundColor,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      if (!navigator.clipboard?.write) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `nixpkgs-pr-${prNumber()}.png`;
        a.click();
        setCopied(true);
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopied(true);
      }

      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        "Failed to copy image — try again or use a Chromium browser",
      );
    }
  }

  onMount(() => {
    void ensureBranches();
    if (parsePrInput(prInput())) void handleCheck();
  });

  return (
    <div class="tracker">
      <header class="header">
        <h1 class="title">Nixpkgs Tracker</h1>
        <p class="subtitle">
          Check whether a nixpkgs PR has reached your branches
        </p>
      </header>

      <div class="main-row">
        <Show when={!isRelease()}>
          <div class="branch-section">
            <p class="branch-label" id="branch-label">
              Branches
            </p>
            <div
              class="branch-checkboxes"
              role="group"
              aria-labelledby="branch-label"
            >
              <For each={availableBranches()}>
                {(b) => (
                  <label class="branch-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedBranches().has(b)}
                      onChange={() => handleToggleBranch(b)}
                      disabled={loading()}
                    />
                    <span>{b}</span>
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="input-col">
          <div class="input-group">
            <label class="label" for="tracker-pr-input">
              PR Number
            </label>
            <input
              id="tracker-pr-input"
              type="text"
              class="input"
              inputMode="numeric"
              autocomplete="off"
              spellcheck={false}
              placeholder="e.g. 512987 or GitHub PR URL"
              value={prInput()}
              onInput={(e) => setPrInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={loading()}
              aria-invalid={!!error() && !prTitle()}
              aria-describedby={error() ? "tracker-error" : undefined}
            />
          </div>

          <div class="btn-row">
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => void handleCheck()}
              disabled={loading() || !prInput().trim()}
            >
              {loading() ? "Checking…" : "Check"}
            </button>

            <button
              type="button"
              class="btn"
              onClick={() => void handleCopyImage()}
              disabled={!prTitle() || loading()}
            >
              {copied() ? "Copied!" : "Copy image"}
            </button>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <p class="error" id="tracker-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={copyError()}>
        <p class="error" role="alert">
          {copyError()}
        </p>
      </Show>

      <Show when={prTitle()}>
        <div class="result-card" ref={resultCardRef}>
          <a
            class="pr-title"
            href={`https://github.com/NixOS/nixpkgs/pull/${prNumber()}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            #{prNumber()} {prTitle()}
          </a>

          <div class="pr-meta">
            <Show when={prMerged()}>
              <span class="badge badge-merged">Merged</span>
            </Show>
            <Show when={prClosed()}>
              <span class="badge badge-closed">Closed</span>
            </Show>
            <Show when={!prMerged() && !prClosed()}>
              <span class="badge badge-open">Open</span>
            </Show>
            <Show when={prBase()}>
              <span class="badge badge-base">base: {prBase()}</span>
            </Show>
          </div>

          <Show when={isRelease()}>
            <p class="release-hint">
              Release branch detected, checking {prBase()} only
            </p>
          </Show>

          <div class="status-list" role="list">
            <For each={branchStatuses()}>
              {(bs) => (
                <div
                  class={`status-item ${
                    bs.checking
                      ? "checking"
                      : bs.error
                        ? "error-state"
                        : bs.merged
                          ? "merged"
                          : "unmerged"
                  }`}
                  role="listitem"
                >
                  <input
                    type="checkbox"
                    class="status-icon"
                    checked={bs.merged && !bs.checking && !bs.error}
                    disabled
                    tabindex={-1}
                    aria-hidden="true"
                  />
                  <span class="status-name">{bs.name}</span>
                  <Show when={bs.checking}>
                    <span class="status-hint">checking…</span>
                  </Show>
                  <Show when={bs.error}>
                    <span class="status-hint">failed</span>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <Show when={!loading() && branchStatuses().length > 0}>
            <p class="summary">
              Merged to {mergedCount()} / {branchStatuses().length} branches
            </p>
          </Show>
        </div>
      </Show>

      <div class="token-section">
        <button
          type="button"
          class="token-toggle"
          onClick={() => setShowToken(!showToken())}
          aria-expanded={showToken()}
        >
          {token()
            ? "Token set (click to change)"
            : "Set GitHub token to increase rate limit"}
        </button>
        <Show when={showToken()}>
          <div class="token-row">
            <input
              type="password"
              class="input token-input"
              placeholder="ghp_… or github_pat_…"
              value={token()}
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => saveToken(e.currentTarget.value)}
              aria-label="GitHub personal access token"
            />
            <Show when={token()}>
              <button type="button" class="btn btn-small" onClick={clearToken}>
                Clear
              </button>
            </Show>
          </div>
          <p class="token-hint">
            Stored only in this browser's localStorage. Needs public repo read
            access.
          </p>
        </Show>
      </div>
    </div>
  );
}
