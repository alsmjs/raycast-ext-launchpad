import { getApplications } from "@raycast/api";
import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { appScanSignature, DirSnapshot } from "../core/appScan";
import { parseDisplayNames } from "../core/displayNames";
import { dedupeInstalled, InstalledApp } from "../core/sync";
import { BIN, runKeepingPartialOutput, timed } from "./proc";

/**
 * The directories the change fingerprint watches. Not exhaustive by design —
 * see `core/appScan.ts` for why that's acceptable.
 */
const APP_ROOTS = [
  "/Applications",
  "/Applications/Utilities",
  join(homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
];

function snapshot(dir: string): DirSnapshot {
  try {
    return {
      dir,
      mtimeMs: statSync(dir).mtimeMs,
      appNames: readdirSync(dir).filter((name) => name.endsWith(".app")),
    };
  } catch {
    return { dir, mtimeMs: 0, appNames: [] };
  }
}

/** A few `readdirSync` calls, no subprocess. Cheap enough to run on every open. */
export function currentScanSignature(): string {
  return appScanSignature(APP_ROOTS.map(snapshot));
}

/**
 * Resolve the names macOS actually displays, via Spotlight's
 * `kMDItemDisplayName` — one batched call for every app.
 *
 * This is the source of truth, not a fallback. `Application.localizedName`
 * looks like a free replacement and isn't: with a zh-Hans system it was
 * populated for 74 of 101 apps here, and for a good share of those it still
 * returned the English bundle name, so trusting it silently lost Chinese names.
 * `kMDItemDisplayName` is by definition what Finder and Launchpad show.
 *
 * The batch costs ~110ms for ~100 apps, and it only runs when the directory
 * fingerprint has actually moved (see `core/appScan.ts`) — which is what made
 * preferring the cheaper-but-wrong source pointless in the first place.
 */
function resolveDisplayNames(paths: string[]): Map<string, string> {
  if (paths.length === 0) return new Map();
  // Lenient: a single path vanishing mid-batch must not cost every other name.
  const raw = runKeepingPartialOutput(BIN.mdls, ["-name", "kMDItemDisplayName", ...paths]);
  return raw ? parseDisplayNames(raw, paths) : new Map();
}

export async function listInstalled(): Promise<InstalledApp[]> {
  const applications = await timed("getApplications", () => getApplications());

  // LaunchServices keeps registrations long after the bundle is gone — apps in
  // the Trash, half-finished installers, superseded self-updates all linger. A
  // bundle that isn't on disk isn't installed, can't be launched, and would
  // abort the `mdls` batch below. Filtering *before* dedupe also matters: if a
  // stale path were listed first for a bundleId, dedupe would keep it and drop
  // the real copy.
  const installed = applications.filter((a) => a.bundleId && existsSync(a.path));

  const displayNames = await timed(`mdls display names (${installed.length} apps)`, async () =>
    resolveDisplayNames(installed.map((a) => a.path)),
  );

  return dedupeInstalled(
    installed.map((a) => ({
      bundleId: a.bundleId!,
      name: a.name,
      localizedName: displayNames.get(a.path) ?? a.localizedName ?? a.name,
      path: a.path,
    })),
  );
}
