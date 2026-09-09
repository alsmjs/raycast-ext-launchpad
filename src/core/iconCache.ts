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
