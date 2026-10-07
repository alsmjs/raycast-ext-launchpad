import { environment } from "@raycast/api";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { unlink } from "fs/promises";
import { join } from "path";
import { mapLimit } from "../core/concurrency";
import { APP_ICON_SIZE, appIconKey } from "../core/iconCache";
import { icnsToPng } from "./icns";

/**
 * Per-app icons, extracted from each bundle's `.icns` and cached on disk.
 *
 * This replaces Raycast's `{ fileIcon }` in the grid. Raycast 2 renders
 * `fileIcon` at too low a resolution for a grid cell; side by side with the
 * same icon extracted by `sips` it is visibly blurry.
 *
 * Cost model, per the performance contract:
 *   - lookup: one `stat` of Info.plist + one `existsSync` per app, no
 *     subprocess. Done once at startup and after a sync, never per render and
 *     never on a user mutation — moving an app doesn't change its icon.
 *   - build: only on a cache miss (cold cache, a new or updated app), bounded
 *     to 8 concurrent extractions. ~65 apps take ~0.5 s from cold.
 */

const CONCURRENCY = 8;

function cacheDir(): string {
  return join(environment.supportPath, "app-icons");
}

/** Null when the bundle (or its Info.plist) is gone. */
function cachePath(appPath: string): string | null {
  try {
    const mtime = statSync(join(appPath, "Contents/Info.plist")).mtimeMs;
    return join(cacheDir(), `${appIconKey(appPath, mtime)}.png`);
  } catch {
    return null;
  }
}

/** appPath → cached PNG, for every app that already has one. No subprocesses. */
export function lookupAppIcons(appPaths: Iterable<string>): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const appPath of appPaths) {
    const path = cachePath(appPath);
    if (path && existsSync(path)) icons[appPath] = path;
  }
  return icons;
}

/**
 * Marker for "this exact build of the app has no `.icns`" — e.g. one that
 * ships only an asset catalog. Without it such an app would
 * count as a cache miss on every launch and re-run `plutil` forever. Keyed the
 * same way as the icon, so an app update clears it and extraction is retried.
 */
const noIcon = (out: string) => `${out}.none`;

/**
 * Extract every icon in `appPaths` that isn't cached yet.
 *
 * Writes to a temporary name and renames into place, so a run killed half-way
 * through can't leave a truncated PNG that `existsSync` would then accept as a
 * valid cache entry forever.
 */
export async function buildMissingAppIcons(appPaths: string[]): Promise<number> {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const missing = appPaths
    .map((appPath) => ({ appPath, out: cachePath(appPath) }))
    .filter(
      (x): x is { appPath: string; out: string } => x.out !== null && !existsSync(x.out) && !existsSync(noIcon(x.out)),
    );

  const built = await mapLimit(missing, CONCURRENCY, async ({ appPath, out }) => {
    const tmp = `${out}.tmp`;
    try {
      const result = await icnsToPng(appPath, APP_ICON_SIZE, tmp);
      // Only a structural miss is remembered. A conversion that failed under
      // load stays a plain cache miss and is retried next launch — otherwise one
      // bad moment would pin a perfectly normal app to the blurry fallback until
      // its next update.
      if (result === "no-icns") writeFileSync(noIcon(out), "");
      if (result !== "ok") return false;
      renameSync(tmp, out);
      return true;
    } catch {
      return false;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  });

  return built.filter(Boolean).length;
}

/**
 * Remove cached icons no current app maps to — superseded by an app update
 * (the key includes Info.plist's mtime) or belonging to an uninstalled app.
 * Pass every app the config knows about, hidden ones included, so unhiding
 * never has to wait for an extraction.
 */
export function pruneAppIcons(appPaths: Iterable<string>): void {
  const dir = cacheDir();
  if (!existsSync(dir)) return;

  const wanted = new Set<string>();
  for (const appPath of appPaths) {
    const path = cachePath(appPath);
    if (!path) continue;
    const file = path.slice(dir.length + 1);
    wanted.add(file);
    wanted.add(noIcon(file));
  }

  try {
    for (const file of readdirSync(dir)) {
      if (wanted.has(file)) continue;
      try {
        unlinkSync(join(dir, file));
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* best-effort */
  }
}
