import crypto from "crypto";

/** A folder icon is a 3×3 composite, so only the first nine apps matter. */
export const MAX_ICON_CELLS = 9;

/**
 * Bump to invalidate every cached composite at once, e.g. after changing the
 * layout constants or the cache location.
 */
export const ICON_CACHE_VERSION = "v4-padded";

/** The apps that actually appear in a folder's composite icon. */
export function iconSourcePaths(appPaths: string[]): string[] {
  return appPaths.slice(0, MAX_ICON_CELLS);
}

/**
 * Cache key for a folder's composite icon.
 *
 * Deliberately position-sensitive: the paths are joined in order, so reordering
 * the top nine apps produces a different key and the icon is rebuilt. That is
 * the point — the composite shows those apps in that arrangement.
 */
export function folderIconKey(folderId: string, appPaths: string[]): string {
  return crypto
    .createHash("md5")
    .update(`${ICON_CACHE_VERSION}:${folderId}${iconSourcePaths(appPaths).join("|")}`)
    .digest("hex");
}

// ── App icons ──────────────────────────────────────────────────────────────

/**
 * Pixel width of a cached app icon.
 *
 * Raycast 2 renders `{ fileIcon }` at a resolution too low for a grid cell —
 * visibly blurry next to the same icon extracted from its `.icns` — so app
 * icons are extracted and cached by us instead. 256 is above 1:1 for a grid
 * cell on a Retina display; 512 extracts just as fast but costs ~4× the decoded
 * memory on Raycast's side (100 apps × 512² × RGBA ≈ 100 MB vs ≈ 26 MB). If 256
 * ever reads soft, raise it — the size is part of the cache key.
 */
export const APP_ICON_SIZE = 256;

/** Bump to invalidate every cached app icon, e.g. after changing the size. */
export const APP_ICON_CACHE_VERSION = "v1";

/**
 * Cache key for one app's icon.
 *
 * Keyed on the bundle path plus `Info.plist`'s mtime rather than on the icon
 * file: finding the icon file means asking `plutil`, a subprocess, whereas the
 * mtime is a single `stat` — cheap enough to check for every app on every
 * launch. An app update that changes the icon rewrites `Info.plist`, so the
 * key moves with it.
 */
export function appIconKey(appPath: string, infoPlistMtimeMs: number): string {
  return crypto
    .createHash("md5")
    .update(`${APP_ICON_CACHE_VERSION}:${APP_ICON_SIZE}:${appPath}:${infoPlistMtimeMs}`)
    .digest("hex");
}
