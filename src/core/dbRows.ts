import { InstalledApp } from "./sync";
import { AppEntry, Folder, LaunchpadConfig } from "./types";

/**
 * Parsing for the one-time import from the real macOS Launchpad database.
 * The query and the sqlite3 shell-out live in `services/launchpadDb.ts`; only
 * the text munging is here so it can be tested.
 */

/** Chosen because it can't occur in an app or folder title. */
export const DB_SEPARATOR = "|||";

export interface RawDbRow {
  groupTitle: string | null;
  appTitle: string;
  bundleId: string;
}

/** Launchpad's internal group titles — these are not user-created folders. */
const SYSTEM_GROUPS: ReadonlySet<string> = new Set(["Root", "HoldingPage", "Default", ""]);

/**
 * sqlite3 prints one row per line. A NULL `groupTitle` (an app that sits on a
 * page rather than inside a folder) arrives as the literal string "null" with
 * the `-separator` flag, which is why it needs converting back by hand.
 */
export function parseDbRows(raw: string): RawDbRow[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [groupTitle, appTitle, bundleId] = line.split(DB_SEPARATOR);
      return {
        groupTitle: groupTitle && groupTitle !== "null" ? groupTitle : null,
        appTitle: appTitle ?? "",
        bundleId: bundleId ?? "",
      };
    })
    .filter((row) => row.bundleId !== "");
}

function toEntry(app: InstalledApp): AppEntry {
  const entry: AppEntry = { bundleId: app.bundleId, name: app.localizedName || app.name, path: app.path };
  if (app.name && app.name !== entry.name) entry.systemName = app.name;
  return entry;
}

/**
 * Rebuild the user's Launchpad layout from the DB rows. Anything not in a
 * user-created folder falls through to the top level.
 *
 * The `placed` set only records apps that actually landed in a folder. That
 * distinction matters: on this machine 31 of 77 apps sit in Launchpad's own
 * `Default` group or on a page with no group at all, and treating "appeared in
 * the DB" as "placed" made every one of them vanish from the import — in
 * neither a folder nor the top level.
 *
 * `newId` is injected rather than calling `crypto.randomUUID()` directly so the
 * result is deterministic under test.
 */
export function buildImportedLayout(
  rows: RawDbRow[],
  installed: InstalledApp[],
  newId: () => string,
): Pick<LaunchpadConfig, "folders" | "uncategorized"> {
  const byBundleId = new Map(installed.map((a) => [a.bundleId, a]));
  const folderApps = new Map<string, AppEntry[]>();
  const seen = new Set<string>();
  const placed = new Set<string>();

  for (const row of rows) {
    const app = byBundleId.get(row.bundleId);
    if (!app || seen.has(app.bundleId)) continue;
    seen.add(app.bundleId);

    const title = row.groupTitle && !SYSTEM_GROUPS.has(row.groupTitle) ? row.groupTitle : null;
    if (!title) continue;

    placed.add(app.bundleId);
    const bucket = folderApps.get(title);
    if (bucket) bucket.push(toEntry(app));
    else folderApps.set(title, [toEntry(app)]);
  }

  const folders: Folder[] = Array.from(folderApps, ([name, apps]) => ({ id: newId(), name, apps }));
  const uncategorized = installed.filter((a) => !placed.has(a.bundleId)).map(toEntry);

  return { folders, uncategorized };
}
