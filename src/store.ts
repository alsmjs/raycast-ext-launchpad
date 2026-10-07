import { showToast, Toast } from "@raycast/api";
import { useSyncExternalStore } from "react";
import { needsFullScan } from "./core/appScan";
import { mergeInstalled } from "./core/sync";
import { emptyConfig, Folder, LaunchpadConfig } from "./core/types";
import { buildMissingAppIcons, lookupAppIcons, pruneAppIcons } from "./services/appIcon";
import { currentScanSignature, listInstalled } from "./services/applications";
import { buildFolderIcon, buildFolderIconSync, cachedFolderIcon, pruneIconCache } from "./services/folderIcon";
import { importLayout } from "./services/launchpadDb";
import { loadConfig, loadScanState, saveConfig, saveScanState } from "./services/storage";
import { timed } from "./services/proc";

/**
 * The single source of truth for the whole command.
 *
 * It lives outside React on purpose. Raycast's `push()` stores the JSX element
 * it was handed, so a pushed screen keeps whatever props it was created with and
 * never re-renders when its parent's state moves — and a Context provider can't
 * reach it either, since the navigation container renders it outside our tree.
 * The previous design worked around that by having `FolderGrid` hold its own
 * copy of the config and push the whole thing back up, which meant a background
 * sync that landed while the user was inside a folder got silently reverted by
 * their next action.
 *
 * An external store sidesteps all of it: every screen subscribes to the same
 * state regardless of where it sits in the navigation stack, and `mutate` takes
 * an updater, so "overwrite the world with my stale snapshot" is not expressible.
 */

export interface LaunchpadState {
  config: LaunchpadConfig | null;
  /** folderId → composite PNG path. Folders without one fall back to a plain icon. */
  folderIcons: Record<string, string>;
  /**
   * app path → cached high-res PNG. Apps without one fall back to `fileIcon`.
   * Untouched by `mutate`: moving an app doesn't change its icon, so user
   * actions never pay for a lookup.
   */
  appIcons: Record<string, string>;
  isSyncing: boolean;
  /**
   * Set only when there is no config to show at all — a first run whose import
   * failed. Without it the grid would spin forever. A failed sync over an
   * existing config is not a load error: the cached layout is still correct
   * enough to use, so that case is reported with a toast instead.
   */
  loadError: string | null;
}

let state: LaunchpadState = { config: null, folderIcons: {}, appIcons: {}, isSyncing: false, loadError: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<LaunchpadState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLaunchpad(): LaunchpadState {
  return useSyncExternalStore(subscribe, () => state);
}

// ── Folder icons ───────────────────────────────────────────────────────────
//
// Two functions, deliberately different, and the difference is the whole point:
//
//   lookupFolderIcons        cache hits only, zero subprocesses
//   computeFolderIconsSync   builds on a miss, blocking
//
// The blocking one is reserved for user mutations, where the composite has to
// be right in the same render as the config change — moving an app and watching
// the folder icon catch up a beat later is the thing this codebase refuses to
// ship. Everywhere else (first paint, background sync) uses the cheap lookup and
// lets `fillMissingIcons` catch up asynchronously.
//
// Both REPLACE the map rather than merging it, so a folder that just lost its
// last app drops out and renders a plain folder icon on the next frame.

function lookupFolderIcons(folders: Folder[]): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const folder of folders) {
    if (folder.apps.length === 0) continue;
    const path = cachedFolderIcon(
      folder.id,
      folder.apps.map((a) => a.path),
    );
    if (path) icons[folder.id] = path;
  }
  return icons;
}

function computeFolderIconsSync(folders: Folder[]): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const folder of folders) {
    if (folder.apps.length === 0) continue;
    const paths = folder.apps.map((a) => a.path);
    const path = cachedFolderIcon(folder.id, paths) ?? buildFolderIconSync(folder.id, paths);
    if (path) icons[folder.id] = path;
  }
  return icons;
}

/** Every app the config knows about, hidden ones included so unhide is instant. */
function allAppPaths(config: LaunchpadConfig): string[] {
  return [
    ...config.folders.flatMap((f) => f.apps.map((a) => a.path)),
    ...config.uncategorized.map((a) => a.path),
    ...config.hidden.map((a) => a.path),
  ];
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * The only way to change the config. Takes an updater rather than a value, so a
 * caller can never write back a stale snapshot.
 *
 * The `next === current` check is what makes the pure mutations in
 * `core/mutations.ts` pay off: holding ⌥⇧← on the first app produces no render,
 * no icon rebuild and no write.
 */
export function mutate(update: (config: LaunchpadConfig) => LaunchpadConfig): void {
  const current = state.config;
  if (!current) return;

  const next = update(current);
  if (next === current) return;

  setState({ config: next, folderIcons: computeFolderIconsSync(next.folders) });

  saveConfig(next).catch(() =>
    showToast({ style: Toast.Style.Failure, title: "Failed to save — changes will be lost on restart" }),
  );
}

// ── Startup ────────────────────────────────────────────────────────────────

let started = false;
let iconsFilled = false;

/**
 * Idempotent within a launch. (Each launch gets a fresh module instance —
 * verified on Raycast 2, where commands run as workers inside the shared
 * "Raycast Backend" process — so this guard only ever dedupes calls within one
 * session.)
 */
export function startLaunchpad(): void {
  if (started) return;
  started = true;
  void bootstrap();
}

/** For the "Try Again" action on a failed first run. */
export function retryLaunchpad(): void {
  started = false;
  setState({ loadError: null });
  startLaunchpad();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bootstrap(): Promise<void> {
  try {
    const cached = await loadConfig();

    if (cached) {
      // Paint from cache first — no subprocesses, no LaunchServices — then
      // decide whether the system even needs re-scanning.
      setState({
        config: cached,
        folderIcons: lookupFolderIcons(cached.folders),
        appIcons: lookupAppIcons(allAppPaths(cached)),
      });
      await syncIfStale().catch((error) =>
        showToast({ style: Toast.Style.Failure, title: "Couldn't check for new apps", message: errorMessage(error) }),
      );
    } else {
      // First ever launch: import the layout from the real Launchpad database.
      const installed = await listInstalled();
      const config: LaunchpadConfig = { ...emptyConfig(), ...importLayout(installed) };
      setState({
        config,
        folderIcons: lookupFolderIcons(config.folders),
        appIcons: lookupAppIcons(allAppPaths(config)),
      });
      await saveConfig(config);
      await saveScanState({ signature: currentScanSignature(), lastFullScanAt: Date.now() });
    }
  } catch (error) {
    // Deliberately nothing is saved here. Persisting an empty config would make
    // every later launch take the "cached" branch and never attempt the
    // Launchpad import again.
    if (!state.config) setState({ loadError: errorMessage(error) });
    return;
  }

  // App icons first: they cover the whole grid, and a folder still waiting on
  // its composite falls back to its first app's icon.
  await fillMissingAppIcons();
  await fillMissingIcons();

  // Guarded: an empty list would make a sweep wipe its whole cache, and "we
  // somehow have no config" is not a reason to throw the icons away.
  if (state.config) {
    pruneIconCache(state.config.folders);
    pruneAppIcons(allAppPaths(state.config));
  }
}

/**
 * Extract any app icon that isn't cached — every app on a cold cache, just the
 * new ones after a sync. Unlike folder composites this is safe to run after
 * startup too: it only ever swaps a blurry placeholder for the sharp version
 * of the same icon, so nothing visibly moves under the user.
 */
async function fillMissingAppIcons(): Promise<void> {
  const config = state.config;
  if (!config) return;

  const built = await timed("build app icons", () => buildMissingAppIcons(allAppPaths(config)));
  if (built > 0 && state.config) setState({ appIcons: lookupAppIcons(allAppPaths(state.config)) });
}

/**
 * Build the composites that weren't cached, in parallel, once per session.
 *
 * Restricted to startup on purpose: rebuilding asynchronously in the middle of a
 * user's edits would repaint folder cells underneath them.
 */
async function fillMissingIcons(): Promise<void> {
  if (iconsFilled) return;
  iconsFilled = true;

  const folders = state.config?.folders ?? [];
  const missing = folders.filter((f) => f.apps.length > 0 && !state.folderIcons[f.id]);
  if (missing.length === 0) return;

  await timed(`build ${missing.length} folder icons`, () =>
    Promise.all(
      missing.map((f) =>
        buildFolderIcon(
          f.id,
          f.apps.map((a) => a.path),
        ),
      ),
    ),
  );

  // Re-derive from the cache rather than trusting the paths we just built: the
  // user may have reorganised a folder while this was running, in which case the
  // freshly-built composite is already the wrong one and the lookup will skip it.
  const config = state.config;
  if (config) setState({ folderIcons: lookupFolderIcons(config.folders) });
}

// ── System sync ────────────────────────────────────────────────────────────

/**
 * Re-scan only when something in the app directories actually moved.
 *
 * Installing an app is a rare event; opening this command is not. Fingerprinting
 * the directories costs a few `readdirSync` calls, which is a rounding error
 * next to a full LaunchServices enumeration plus an `mdls` batch on every open.
 */
async function syncIfStale(): Promise<void> {
  const signature = currentScanSignature();
  const previous = await loadScanState();
  if (!needsFullScan(previous, signature, Date.now())) return;
  await runSync(signature);
}

/** Manual escape hatch for apps installed somewhere the fingerprint can't see. */
export async function rescanApplications(): Promise<void> {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Rescanning applications…" });
  try {
    const changed = await runSync(currentScanSignature());
    if (changed) await fillMissingAppIcons();
    toast.style = Toast.Style.Success;
    toast.title = changed ? "Applications updated" : "Already up to date";
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Rescan failed";
    toast.message = errorMessage(error);
  }
}

async function runSync(signature: string): Promise<boolean> {
  if (!state.config) return false;
  setState({ isSyncing: true });

  try {
    const installed = await listInstalled();

    // Re-read: the user may have moved things while the scan was running.
    const current = state.config;
    if (!current) return false;

    const next = mergeInstalled(current, installed);
    if (next !== current) {
      // The cheap lookup, not the blocking build: this isn't a user action, so
      // there's nothing for the icon to lag behind. `fillMissingIcons` covers
      // any composite that a newly-added app invalidated.
      setState({
        config: next,
        folderIcons: lookupFolderIcons(next.folders),
        appIcons: lookupAppIcons(allAppPaths(next)),
      });
      await saveConfig(next);
    }

    await saveScanState({ signature, lastFullScanAt: Date.now() });
    return next !== current;
  } finally {
    setState({ isSyncing: false });
  }
}
