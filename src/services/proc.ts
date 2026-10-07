import { execFile, execFileSync } from "child_process";
import { environment } from "@raycast/api";

/**
 * Every subprocess in this extension goes through here.
 *
 * Two rules, applied uniformly: a timeout (a wedged `mdls` must never wedge the
 * grid) and failure-as-null (each caller already has a sensible fallback — the
 * bundle name, the plain `open`, an empty icon cell — so throwing would only
 * force the same try/catch to be written six times).
 *
 * `execFile` rather than `exec`: arguments are passed as an array, so app paths
 * with spaces or quotes never reach a shell.
 */

/**
 * Absolute paths, never bare names.
 *
 * Raycast's extension process does not have `/usr/sbin` on its PATH, so
 * `execFileSync("scutil", …)` fails with ENOENT — which, combined with
 * failure-as-null, looked exactly like "no proxy is configured". Everything else
 * we call happens to live in `/usr/bin` and worked by luck. Spelling all of them
 * out removes PATH from the equation.
 */
export const BIN = {
  getconf: "/usr/bin/getconf",
  lsappinfo: "/usr/bin/lsappinfo",
  mdls: "/usr/bin/mdls",
  open: "/usr/bin/open",
  osascript: "/usr/bin/osascript",
  plutil: "/usr/bin/plutil",
  scutil: "/usr/sbin/scutil",
  sips: "/usr/bin/sips",
  sqlite3: "/usr/bin/sqlite3",
} as const;

/**
 * `run` and `runAsync` accept nothing else, so `run("scutil", …)` is a compile
 * error rather than a silent ENOENT. Same trick as `mutate` taking an updater:
 * make the mistake unrepresentable instead of remembering not to make it.
 */
export type BinPath = (typeof BIN)[keyof typeof BIN];

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Swallowing the reason is right in production and useless in development —
 * an ENOENT and a non-zero exit are the same `null` to the caller, and the
 * difference is exactly what you need when a feature silently does nothing.
 */
function logFailure(command: string, args: string[], error: unknown): void {
  if (!environment.isDevelopment) return;
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`[launchpad] ${command} ${args.join(" ")} failed: ${reason}`);
}

export function run(command: BinPath, args: string[], timeout = DEFAULT_TIMEOUT_MS): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    logFailure(command, args, error);
    return null;
  }
}

/**
 * Like `run`, but a non-zero exit still returns whatever reached stdout.
 *
 * For batch tools that fail *part-way*. `mdls` given one missing path among a
 * hundred prints the results it had, then the error, then exits 1 without
 * touching the rest — so treating the exit code as all-or-nothing throws away
 * every name it did resolve. Returns null only when there is no output at all
 * (spawn failure, timeout before any write).
 */
export function runKeepingPartialOutput(command: BinPath, args: string[], timeout = DEFAULT_TIMEOUT_MS): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    logFailure(command, args, error);
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" && stdout.length > 0 ? stdout : null;
  }
}

export function runAsync(command: BinPath, args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout }, (error, stdout) => {
      if (error) logFailure(command, args, error);
      resolve(error ? null : stdout);
    });
  });
}

/**
 * Timing probe for the development build only. The hot path ("open the
 * extension → enter a folder → launch an app") is the thing this project
 * optimizes for, so it needs to be measurable rather than guessed at.
 */
export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!environment.isDevelopment) return work();
  const started = Date.now();
  try {
    return await work();
  } finally {
    console.log(`[launchpad] ${label}: ${Date.now() - started}ms`);
  }
}
