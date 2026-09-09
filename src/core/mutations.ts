import { AppEntry, isOverrideActive, LaunchOverride, LaunchpadConfig, Scope } from "./types";

/**
 * Every function here is pure and returns the *same* config reference when the
 * operation is a no-op (app not found, already at the edge, name unchanged, …).
 * `store.mutate` relies on that identity check to skip a render and a write —
 * so holding a first-column app on ⌥⇧← costs literally nothing.
 */

export type MoveTarget =
  | { kind: "folder"; folderId: string }
  | { kind: "uncategorized" }
  | { kind: "newFolder"; folderId: string; name: string };

// ── Array helpers ──────────────────────────────────────────────────────────

/** Filter out `ids`, returning the original array untouched when nothing matched. */
function reject(entries: AppEntry[], ids: ReadonlySet<string>): AppEntry[] {
  if (!entries.some((e) => ids.has(e.bundleId))) return entries;
  return entries.filter((e) => !ids.has(e.bundleId));
}

/** Swap an item with its neighbour. Returns the original array if it can't move. */
function swap(entries: AppEntry[], bundleId: string, delta: 1 | -1): AppEntry[] {
  const i = entries.findIndex((e) => e.bundleId === bundleId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= entries.length) return entries;
  const next = [...entries];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * Gather the entries for `ids` in visual order — uncategorized first, then each
 * folder in order. A multi-select is always scoped to one bucket, so this
 * preserves the order the user saw when selecting.
 */
function collect(config: LaunchpadConfig, ids: ReadonlySet<string>): AppEntry[] {
  const found: AppEntry[] = [];
  for (const e of config.uncategorized) if (ids.has(e.bundleId)) found.push(e);
  for (const f of config.folders) for (const e of f.apps) if (ids.has(e.bundleId)) found.push(e);
  return found;
}

// ── App mutations ──────────────────────────────────────────────────────────

/**
 * The single move primitive. Replaces what used to be eight near-identical
 * functions spread across the two grids.
 *
 * Ordering rules, preserved verbatim from the original implementation because
 * they are muscle memory by now:
 *   - into a folder      → appended at the END
 *   - out to top level   → inserted at the FRONT (easy to find right after the action)
 *   - into a new folder  → the folder is appended after the existing ones
 */
export function moveApps(config: LaunchpadConfig, bundleIds: Iterable<string>, target: MoveTarget): LaunchpadConfig {
  const ids = new Set(bundleIds);
  if (ids.size === 0) return config;

  // Refuse to move into a folder that doesn't exist rather than dropping the apps.
  if (target.kind === "folder" && !config.folders.some((f) => f.id === target.folderId)) return config;

  const moved = collect(config, ids);
  if (moved.length === 0) return config;

  const folders = config.folders.map((f) => {
    const apps = reject(f.apps, ids);
    return apps === f.apps ? f : { ...f, apps };
  });
  const uncategorized = reject(config.uncategorized, ids);

  switch (target.kind) {
    case "folder":
      return {
        ...config,
        folders: folders.map((f) => (f.id === target.folderId ? { ...f, apps: [...f.apps, ...moved] } : f)),
        uncategorized,
      };
    case "uncategorized":
      return { ...config, folders, uncategorized: [...moved, ...uncategorized] };
    case "newFolder":
      return {
        ...config,
        folders: [...folders, { id: target.folderId, name: target.name, apps: moved }],
        uncategorized,
      };
  }
}

/** Move one app one slot left (-1) or right (+1) within its bucket. */
export function reorderApp(config: LaunchpadConfig, scope: Scope, bundleId: string, delta: 1 | -1): LaunchpadConfig {
  if (scope.kind === "uncategorized") {
    const uncategorized = swap(config.uncategorized, bundleId, delta);
    return uncategorized === config.uncategorized ? config : { ...config, uncategorized };
  }

  const idx = config.folders.findIndex((f) => f.id === scope.folderId);
  if (idx < 0) return config;
  const folder = config.folders[idx];
  const apps = swap(folder.apps, bundleId, delta);
  if (apps === folder.apps) return config;

  const folders = [...config.folders];
  folders[idx] = { ...folder, apps };
  return { ...config, folders };
}

export function hideApps(config: LaunchpadConfig, bundleIds: Iterable<string>): LaunchpadConfig {
  const ids = new Set(bundleIds);
  if (ids.size === 0) return config;

  const hiding = collect(config, ids);
  if (hiding.length === 0) return config;

  return {
    ...config,
    folders: config.folders.map((f) => {
      const apps = reject(f.apps, ids);
      return apps === f.apps ? f : { ...f, apps };
    }),
    uncategorized: reject(config.uncategorized, ids),
    hidden: [...config.hidden, ...hiding],
  };
}

export function unhideAll(config: LaunchpadConfig): LaunchpadConfig {
  if (config.hidden.length === 0) return config;
  return { ...config, uncategorized: [...config.hidden, ...config.uncategorized], hidden: [] };
}

// ── Folder mutations ───────────────────────────────────────────────────────

export function createFolder(config: LaunchpadConfig, folderId: string, name: string): LaunchpadConfig {
  return { ...config, folders: [...config.folders, { id: folderId, name, apps: [] }] };
}

export function renameFolder(config: LaunchpadConfig, folderId: string, name: string): LaunchpadConfig {
  const folder = config.folders.find((f) => f.id === folderId);
  if (!folder || folder.name === name) return config;
  return { ...config, folders: config.folders.map((f) => (f.id === folderId ? { ...f, name } : f)) };
}

/** Delete a folder; its apps are returned to the FRONT of the top level. */
export function deleteFolder(config: LaunchpadConfig, folderId: string): LaunchpadConfig {
  const folder = config.folders.find((f) => f.id === folderId);
  if (!folder) return config;
  return {
    ...config,
    folders: config.folders.filter((f) => f.id !== folderId),
    uncategorized: [...folder.apps, ...config.uncategorized],
  };
}

/** Folders flow left-to-right, so -1 is "left" and +1 is "right". */
export function moveFolder(config: LaunchpadConfig, folderId: string, delta: 1 | -1): LaunchpadConfig {
  const i = config.folders.findIndex((f) => f.id === folderId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= config.folders.length) return config;
  const folders = [...config.folders];
  [folders[i], folders[j]] = [folders[j], folders[i]];
  return { ...config, folders };
}

// ── Launch overrides ───────────────────────────────────────────────────────

/** Setting an empty override removes the key entirely, so `isOverrideActive` stays honest. */
export function setLaunchOverride(
  config: LaunchpadConfig,
  bundleId: string,
  override: LaunchOverride | null,
): LaunchpadConfig {
  const current = config.launchOverrides[bundleId];
  const next = override && isOverrideActive(override) ? override : null;

  if (!next) {
    if (!current) return config;
    const launchOverrides = { ...config.launchOverrides };
    delete launchOverrides[bundleId];
    return { ...config, launchOverrides };
  }

  return { ...config, launchOverrides: { ...config.launchOverrides, [bundleId]: next } };
}

export function toggleSystemProxyInjection(config: LaunchpadConfig, bundleId: string): LaunchpadConfig {
  const current = config.launchOverrides[bundleId];
  return setLaunchOverride(config, bundleId, { ...current, injectSystemProxy: !current?.injectSystemProxy });
}
