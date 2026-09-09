import { open } from "@raycast/api";
import { parseScutilProxy, proxyEnv, SystemProxy } from "../core/proxy";
import { AppEntry, LaunchOverride } from "../core/types";
import { BIN, run, runAsync } from "./proc";

/**
 * Launching apps, with optional environment injection.
 *
 * The interesting constraint: Raycast's `open()` — and `LSOpen` underneath it —
 * hands the app launchd's environment, not ours, so there is no way to pass a
 * variable through it. `open(1)`, however, takes `--env NAME=VALUE`, and the app
 * it starts is owned by launchd rather than being our child. That gets the
 * variables in while keeping every LaunchServices behaviour intact (activating
 * an existing window, the Dock icon, activation policy, sandbox setup) and
 * without any `detached`/`unref` games around how Raycast reaps extensions.
 *
 * The one thing `open --env` cannot do is inject into an app that is *already
 * running*: it prints "additional environment variables could not be set" to
 * stderr — and still exits 0, so the exit code can't be trusted. We check with
 * `lsappinfo` up front instead.
 */

export type LaunchOutcome =
  /** Opened normally; nothing was injected (either nothing to inject, or a fallback). */
  | "plain"
  /** Opened with the requested environment. */
  | "injected"
  /** Already running, so it was just activated — the environment could not apply. */
  | "already-running";

export function readSystemProxy(): SystemProxy {
  // A local SCDynamicStore query, sub-millisecond. Deliberately not cached:
  // toggling a proxy is routine, and a stale value would produce a bug that is
  // near-impossible to reason about from the symptom.
  const raw = run(BIN.scutil, ["--proxy"], 2000);
  return raw ? parseScutilProxy(raw) : {};
}

function isRunning(bundleId: string): boolean {
  // Prints `"pid"=1234` when running, nothing when not.
  // (`pgrep -f` is not an option: BSD pgrep doesn't honour a `^` anchor, and
  // unanchored it matches our own command line.)
  const out = run(BIN.lsappinfo, ["info", "-only", "pid", "-app", bundleId], 2000);
  return out !== null && /"pid"\s*=\s*\d+/.test(out);
}

/**
 * The variables to inject, or null when there is nothing to inject.
 *
 * Returning null for the empty case matters: injecting a blank or placeholder
 * proxy is worse than injecting nothing, because the app would then believe a
 * proxy exists and fail every request through it.
 */
function overrideEnv(override: LaunchOverride | undefined): Record<string, string> | null {
  if (!override) return null;

  const env: Record<string, string> = {};
  if (override.injectSystemProxy) Object.assign(env, proxyEnv(readSystemProxy()));
  Object.assign(env, override.env ?? {}); // explicit values win over the proxy

  return Object.keys(env).length > 0 ? env : null;
}

export async function launchApp(app: AppEntry, override?: LaunchOverride): Promise<LaunchOutcome> {
  const env = overrideEnv(override);

  // No override configured → the original code path, byte for byte.
  if (!env) {
    await open(app.path);
    return "plain";
  }

  if (isRunning(app.bundleId)) {
    await open(app.path); // activate the existing window; the caller explains why
    return "already-running";
  }

  const args = Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  if ((await runAsync(BIN.open, [...args, app.path])) === null) {
    // Worst case is launching without the environment, never failing to launch.
    await open(app.path);
    return "plain";
  }
  return "injected";
}

const QUIT_POLL_MS = 150;
const QUIT_TIMEOUT_MS = 6000;

/**
 * Quit the app, wait for it to actually go, then launch it with the
 * environment. Needed because injection only happens at process start.
 */
export async function quitAndRelaunch(
  app: AppEntry,
  override: LaunchOverride | undefined,
): Promise<LaunchOutcome | "quit-failed"> {
  // Bundle IDs are dotted identifiers; anything else has no business being
  // interpolated into an AppleScript string.
  if (!/^[A-Za-z0-9.\-_]+$/.test(app.bundleId)) return "quit-failed";
  await runAsync(BIN.osascript, ["-e", `tell application id "${app.bundleId}" to quit`], QUIT_TIMEOUT_MS);

  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isRunning(app.bundleId)) return launchApp(app, override);
    await new Promise((resolve) => setTimeout(resolve, QUIT_POLL_MS));
  }
  return "quit-failed";
}
