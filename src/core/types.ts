/**
 * Pure data model. Nothing in `src/core` may import `@raycast/api`, `react`, or
 * touch the filesystem — that is what makes this layer unit-testable under
 * plain Node (see `vitest.config.ts`).
 */

export interface AppEntry {
  /** Primary key. Everything is keyed off this; `name` and `path` are re-resolved on every sync. */
  bundleId: string;
  /** What the user sees. Localized (`kMDItemDisplayName` / `Application.localizedName`). */
  name: string;
  /**
   * The English bundle name, when it differs from `name`. Fed to `Grid.Item`'s
   * `keywords` so a localized app ("密码") is still findable by typing its
   * English name ("Passwords").
   */
  systemName?: string;
  path: string;
}

export interface Folder {
  id: string;
  name: string;
  apps: AppEntry[];
}

/**
 * Per-app launch customization. Deliberately stored in a top-level map keyed by
 * bundleId rather than on `AppEntry`: an `AppEntry` is a projection of system
 * state and gets filtered out by `mergeInstalled` when a scan doesn't return
 * the app, whereas an override is user intent and must survive that.
 */
export interface LaunchOverride {
  /** Read the system proxy at launch time and inject HTTPS_PROXY / HTTP_PROXY / NO_PROXY. */
  injectSystemProxy?: boolean;
  /** Fixed variables, applied last so they win over the injected proxy. */
  env?: Record<string, string>;
}

export const CONFIG_VERSION = 2;

export interface LaunchpadConfig {
  version: number;
  /** Ordered; user-defined. */
  folders: Folder[];
  /** Apps not in any folder. New installs land at the start. */
  uncategorized: AppEntry[];
  /** Full entries so unhide can restore name/path without a re-scan. */
  hidden: AppEntry[];
  /** key = bundleId. Never garbage-collected when an app is uninstalled. */
  launchOverrides: Record<string, LaunchOverride>;
}

export function emptyConfig(): LaunchpadConfig {
  return { version: CONFIG_VERSION, folders: [], uncategorized: [], hidden: [], launchOverrides: {} };
}

/** Where an app currently lives, for reordering. */
export type Scope = { kind: "uncategorized" } | { kind: "folder"; folderId: string };

export function isOverrideActive(override: LaunchOverride | undefined): boolean {
  if (!override) return false;
  return override.injectSystemProxy === true || Object.keys(override.env ?? {}).length > 0;
}
