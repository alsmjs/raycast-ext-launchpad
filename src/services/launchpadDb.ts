import { existsSync } from "fs";
import { join } from "path";
import { buildImportedLayout, DB_SEPARATOR, parseDbRows } from "../core/dbRows";
import { newId } from "../core/id";
import { InstalledApp } from "../core/sync";
import { LaunchpadConfig } from "../core/types";
import { BIN, run } from "./proc";

/**
 * One-time import of the user's existing layout from the real macOS Launchpad
 * database, run only on the very first launch.
 *
 * Every failure mode here — no DB, an incompatible schema, no `sqlite3` — falls
 * back to a flat list of every installed app. A first run that shows everything
 * unsorted is fine; one that shows nothing is not.
 */

/**
 * The DB lives in a per-user temp directory, *not* in
 * ~/Library/Application Support/Dock as most write-ups claim.
 */
function findDb(): string | null {
  const darwinUserDir = run(BIN.getconf, ["DARWIN_USER_DIR"])?.trim();
  if (!darwinUserDir) return null;
  const path = join(`/private${darwinUserDir}`, "com.apple.dock.launchpad", "db", "db");
  return existsSync(path) ? path : null;
}

/**
 * Schema (macOS 15+):
 *   items  (rowid, uuid, flags, type, parent_id, ordering)
 *            type 2 = folder, type 3 = page, type 4 = app
 *   apps   (item_id, title, bundleid, …)
 *   groups (item_id, category_id, title)   -- folders; there is no items_within_groups table
 *
 * Hierarchy is app → page (type 3) → group, so we join `items` twice to reach
 * the group title. Root pages resolve to Launchpad's own groups ("Default",
 * "Root", …) or to no group at all; `buildImportedLayout` sends those apps to
 * the top level.
 */
const QUERY = [
  "SELECT g.title AS groupTitle, a.title AS appTitle, a.bundleid AS bundleId",
  "FROM apps a",
  "JOIN items app_item ON app_item.rowid = a.item_id",
  "JOIN items page_item ON page_item.rowid = app_item.parent_id",
  "LEFT JOIN groups g ON g.item_id = page_item.parent_id",
  "WHERE a.bundleid IS NOT NULL AND a.bundleid != ''",
  "  AND page_item.type = 3",
  "ORDER BY g.title, page_item.ordering, app_item.ordering;",
].join(" ");

export function importLayout(installed: InstalledApp[]): Pick<LaunchpadConfig, "folders" | "uncategorized"> {
  const flat = () => buildImportedLayout([], installed, newId);

  const db = findDb();
  if (!db) return flat();

  const raw = run(BIN.sqlite3, ["-separator", DB_SEPARATOR, db, QUERY]);
  if (!raw) return flat();

  const rows = parseDbRows(raw);
  if (rows.length === 0) return flat();

  return buildImportedLayout(rows, installed, newId);
}
