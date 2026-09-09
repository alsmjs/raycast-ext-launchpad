import { AppEntry, LaunchOverride, LaunchpadConfig } from "./types";

/** What `services/applications.ts` hands us, stripped of anything Raycast-specific. */
export interface InstalledApp {
  bundleId: string;
  /** The English bundle name. */
  name: string;
  /** The locale-aware display name; equals `name` when the app isn't localized. */
  localizedName: string;
  path: string;
}

/**
 * LaunchServices can return the same bundleId twice — a copy still sitting in
 * ~/Downloads, an Xcode beta, a half-finished update. Keeping both duplicates
 * grid keys and makes `metaByBundleId` silently pick whichever came last, so we
 * collapse to the first occurrence.
 */
export function dedupeInstalled(apps: InstalledApp[]): InstalledApp[] {
  const seen = new Set<string>();
  const out: InstalledApp[] = [];
  for (const app of apps) {
    if (!app.bundleId || seen.has(app.bundleId)) continue;
    seen.add(app.bundleId);
    out.push(app);
  }
  return out;
}

function toEntry(app: InstalledApp): AppEntry {
  const entry: AppEntry = { bundleId: app.bundleId, name: app.localizedName || app.name, path: app.path };
  // Only carry the English name when it actually differs — it exists purely to
  // feed Grid.Item's `keywords`, and storing it unconditionally would bloat the blob.
  if (app.name && app.name !== entry.name) entry.systemName = app.name;
  return entry;
}

/**
 * Reconcile the stored config against what is actually installed.
 *
 * Three rules here are load-bearing safety nets, not incidental details:
 *
 *   1. An empty scan removes nothing. If `getApplications()` returns nothing
 *      (transient failure, permissions), we keep the user's entire layout
 *      rather than wiping it.
 *   2. `hidden` is never filtered by installed-ness. `getApplications()` omits
 *      some system apps, and filtering would make them vanish permanently with
 *      no way to unhide them.
 *   3. `launchOverrides` is carried through untouched, including for apps that
 *      are no longer installed — it is user intent, not a projection of system
 *      state.
 *
 * Returns the *same* config reference when nothing changed, so a routine open
 * of the extension costs no re-render and no write.
 */
export function mergeInstalled(config: LaunchpadConfig, installed: InstalledApp[]): LaunchpadConfig {
  const apps = dedupeInstalled(installed);
  const metaById = new Map(apps.map((a) => [a.bundleId, a]));

  const known = new Set<string>([
    ...config.uncategorized.map((a) => a.bundleId),
    ...config.hidden.map((a) => a.bundleId),
    ...config.folders.flatMap((f) => f.apps.map((a) => a.bundleId)),
  ]);

  /** Refresh the display name and path — both change across app updates and renames. */
  const updateMeta = (entries: AppEntry[]): AppEntry[] =>
    entries.map((e) => {
      const sys = metaById.get(e.bundleId);
      return sys ? toEntry(sys) : e;
    });

  /** Rule 1: an empty scan is treated as "no information", not "nothing is installed". */
  const filterInstalled = (entries: AppEntry[]): AppEntry[] =>
    metaById.size === 0 ? entries : entries.filter((e) => metaById.has(e.bundleId));

  const newApps = apps.filter((a) => !known.has(a.bundleId)).map(toEntry);

  const next: LaunchpadConfig = {
    ...config,
    folders: config.folders.map((f) => ({ ...f, apps: updateMeta(filterInstalled(f.apps)) })),
    // Newly-installed apps go to the front so they're the first thing seen.
    uncategorized: [...newApps, ...updateMeta(filterInstalled(config.uncategorized))],
    hidden: updateMeta(config.hidden), // rule 2
    launchOverrides: config.launchOverrides, // rule 3
  };

  return equalConfig(config, next) ? config : next;
}

// ── Structural equality ────────────────────────────────────────────────────
// Written out rather than JSON.stringify'd so it doesn't silently depend on key
// insertion order surviving a round-trip through LocalStorage.

function equalEntry(a: AppEntry, b: AppEntry): boolean {
  return a.bundleId === b.bundleId && a.name === b.name && a.path === b.path && a.systemName === b.systemName;
}

function equalEntries(a: AppEntry[], b: AppEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => equalEntry(e, b[i]));
}

function equalEnv(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const ak = Object.keys(a ?? {});
  const bk = Object.keys(b ?? {});
  return ak.length === bk.length && ak.every((k) => a![k] === b?.[k]);
}

function equalOverrides(a: Record<string, LaunchOverride>, b: Record<string, LaunchOverride>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => {
    const x = a[k];
    const y = b[k];
    return !!y && x.injectSystemProxy === y.injectSystemProxy && equalEnv(x.env, y.env);
  });
}

export function equalConfig(a: LaunchpadConfig, b: LaunchpadConfig): boolean {
  return (
    a.version === b.version &&
    a.folders.length === b.folders.length &&
    a.folders.every(
      (f, i) => f.id === b.folders[i].id && f.name === b.folders[i].name && equalEntries(f.apps, b.folders[i].apps),
    ) &&
    equalEntries(a.uncategorized, b.uncategorized) &&
    equalEntries(a.hidden, b.hidden) &&
    equalOverrides(a.launchOverrides, b.launchOverrides)
  );
}
