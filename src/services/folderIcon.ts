import { environment } from "@raycast/api";
import crypto from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { CELL, compositeCells } from "../core/composite";
import { folderIconKey, iconSourcePaths } from "../core/iconCache";
import { icnsToPng, icnsToPngSync } from "./icns";

/**
 * Composite folder icons, built on demand and cached on disk.
 *
 * The cache lives in `environment.supportPath` rather than `os.tmpdir()`: macOS
 * wipes the temp directory on reboot and after extended idle, which meant every
 * folder icon was rebuilt from scratch far more often than it had any reason to
 * be. Persisting them is what makes the hot path ("open → enter a folder →
 * launch") consistently fast. The cost is that orphans now accumulate forever,
 * so `pruneIconCache` exists to sweep them.
 */
// Resolved lazily rather than at module scope, so importing this file never
// depends on when Raycast populates `environment`.
function cacheDir(): string {
  return join(environment.supportPath, "folder-icons");
}

function ensureCacheDir(): string {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePath(folderId: string, appPaths: string[]): string {
  return join(cacheDir(), `${folderIconKey(folderId, appPaths)}.png`);
}

/**
 * A bare `existsSync`, no subprocess. This is what the render path calls, which
 * is why it has to stay this cheap.
 */
export function cachedFolderIcon(folderId: string, appPaths: string[]): string | null {
  if (appPaths.length === 0) return null;
  const path = cachePath(folderId, appPaths);
  return existsSync(path) ? path : null;
}

// ── Cell extraction ────────────────────────────────────────────────────────

function tempPng(): string {
  return join(tmpdir(), `lp_icon_${crypto.randomUUID()}.png`);
}

function cellSync(appPath: string): Buffer | null {
  const out = tempPng();
  try {
    return icnsToPngSync(appPath, CELL, out) === "ok" ? readFileSync(out) : null;
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(out);
    } catch {
      /* sips may never have created it */
    }
  }
}

async function cellAsync(appPath: string): Promise<Buffer | null> {
  const out = tempPng();
  try {
    return (await icnsToPng(appPath, CELL, out)) === "ok" ? await readFile(out) : null;
  } catch {
    return null;
  } finally {
    await unlink(out).catch(() => undefined);
  }
}

// ── Builders ───────────────────────────────────────────────────────────────
//
// The two builders differ only in how they gather cells. Keeping both is
// deliberate:
//
//   - the async one runs on first paint, where ten folders can extract icons in
//     parallel and the user is already waiting;
//   - the sync one runs after a user mutation, where the composite has to be
//     correct in the *same* render as the config change. Going async there would
//     flash a stale icon, and this project treats that as worse than a brief
//     hitch.

/** Used after a user mutation. Blocking on purpose — see above. */
export function buildFolderIconSync(folderId: string, appPaths: string[]): string | null {
  const paths = iconSourcePaths(appPaths);
  if (paths.length === 0) return null;

  const out = cachePath(folderId, appPaths);
  ensureCacheDir();
  if (existsSync(out)) return out;

  try {
    writeFileSync(out, compositeCells(paths.map(cellSync)));
    return out;
  } catch {
    return null;
  }
}

/** Used on first paint, where folders can build concurrently. */
export async function buildFolderIcon(folderId: string, appPaths: string[]): Promise<string | null> {
  const paths = iconSourcePaths(appPaths);
  if (paths.length === 0) return null;

  const out = cachePath(folderId, appPaths);
  ensureCacheDir();
  if (existsSync(out)) return out;

  try {
    const cells = await Promise.all(paths.map(cellAsync));
    await writeFile(out, compositeCells(cells));
    return out;
  } catch {
    return null;
  }
}

/**
 * Drop every cached composite that no folder currently wants.
 *
 * The cache key includes the folder's top nine app paths in order, so each
 * reorder or membership change leaves the previous PNG behind. That was
 * self-correcting while the cache lived in the temp directory; now that it
 * persists, it needs sweeping. Called once after first paint, off the hot path.
 */
export function pruneIconCache(folders: { id: string; apps: { path: string }[] }[]): void {
  const dir = cacheDir();
  if (!existsSync(dir)) return;

  const wanted = new Set(
    folders
      .filter((f) => f.apps.length > 0)
      .map(
        (f) =>
          `${folderIconKey(
            f.id,
            f.apps.map((a) => a.path),
          )}.png`,
      ),
  );

  try {
    for (const file of readdirSync(dir)) {
      if (wanted.has(file)) continue;
      try {
        unlinkSync(join(dir, file));
      } catch {
        /* another window may have removed it already */
      }
    }
  } catch {
    /* the whole sweep is best-effort */
  }
}
