# Launchpad for Raycast

A Raycast extension replacing macOS Launchpad (removed in macOS 26 Tahoe). Browse and launch your installed apps in a grid, organized into user-defined folders that are imported from your existing Launchpad layout on first run.

| Top-level grid | Mode dropdown | Multi-Move inside a folder |
| --- | --- | --- |
| ![Top-level grid with folders and a hidden-apps row](./metadata/launchpad-1.png) | ![Apps / Multi-Move dropdown](./metadata/launchpad-2.png) | ![Bulk-move actions inside the Code folder](./metadata/launchpad-3.png) |

## Features

- **Imports your old Launchpad layout** — folders, names, ordering. Reads the macOS Launchpad SQLite DB on first launch.
- **Folders** — create, rename, delete, reorder. Cells show a composite 3×3 preview of up to 9 contained app icons.
- **Hide apps** you never use. Hidden apps are kept around (not just bundleIds) so unhide restores name and path without a re-scan.
- **Multi-Move** — bulk-select apps inside a folder or in the uncategorized bucket and move them all to a folder, top level, or a new folder.
- **Localized names** — "密码", "Karten", "Réglages système" etc. instead of always-English bundle names. Still searchable by the English name.
- **Auto-sync** — newly-installed apps land at the start of the uncategorized bucket the next time you open the extension. Uninstalled apps are dropped from folders automatically. The scan is skipped entirely when nothing has changed, so opening the extension stays fast.
- **Per-app system proxy injection** — for apps that ignore the macOS system proxy and only read `HTTPS_PROXY` (anything built on Rust reqwest, Go net/http or Python requests — Discord's updater being the usual suspect). Toggle it with `⌘⇧P`; those apps get a `🌐` marker.

## Install

### From source (until published to the Raycast Store)

```bash
git clone https://github.com/alsmjs/raycast-ext-launchpad.git
cd raycast-ext-launchpad
npm install
npm run dev
```

`npm run dev` requires Raycast to be running. It imports the extension into Raycast and enables hot-reload. Stop with `Ctrl+C` — the extension stays installed.

To produce a build for the Raycast Store: `npm run build`.

## Usage

Open Raycast and type `launchpad` (or your configured alias).

### Modes

A dropdown in the search bar toggles between two modes:

- **Apps** — single-app actions on the highlighted item.
- **Multi-Move** — bulk-select apps to move them in one go. Selection is scoped to one bucket: either the uncategorized list **or** one specific folder. Switching scope clears the selection.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Enter` | Open app / open folder |
| `Cmd + N` | Create a new folder |
| `Cmd + R` | Rename folder |
| `Ctrl + X` | Delete folder (apps inside flow back to top level) |
| `Opt + Shift + ←` / `→` | Move highlighted folder or app left / right |
| `Cmd + Shift + P` | Toggle system proxy injection for the highlighted app |
| `Cmd + Shift + R` | Rescan applications |
| (Action panel) | Hide app, Move to Folder, Move to Top Level |

In Multi-Move:

| Shortcut | Action |
| --- | --- |
| `Enter` | Toggle selection on highlighted app, or open a folder to select inside it |
| `Cmd + Enter` | Done — exit Multi-Move |
| `Cmd + N` | Move selected apps to a new folder |

### Hidden apps

Hiding an app removes it from the grid but keeps it in your config. A "N hidden apps" cell appears under the main grid when there are any. Its only action is **Unhide All** — there's no per-app unhide UI on purpose, since the bucket is intended as an escape hatch for clutter you rarely revisit.

## How import works

On first launch the extension reads the macOS Launchpad DB at `/private${getconf DARWIN_USER_DIR}com.apple.dock.launchpad/db/db` via the `sqlite3` CLI and reconstructs your folder layout. System-internal groups (`Root`, `HoldingPage`, `Default`) aren't user folders, so the apps in them go to the top level. If the DB is missing or its schema has changed, the extension falls back to a flat uncategorized list of every app `getApplications()` returns.

After first launch the layout lives in Raycast's `LocalStorage`. The macOS DB is never written to.

## How proxy injection works

macOS hands an app launched through LaunchServices the *system* environment, which is why `open()` can't pass anything in. The `open(1)` CLI can, via `--env`, so an app with injection enabled is launched that way with the proxy read live from `scutil --proxy`. Nothing is injected when no proxy is configured, and SOCKS-only setups are left alone.

Environment variables only apply when a process starts, so enabling injection for an app that is already running has no effect — the extension detects this and offers to quit and relaunch it rather than pretending otherwise.

## Constraints

- **Grid columns** are fixed at 8 (the maximum Raycast's `Grid` supports).
- **No drag-and-drop** — Raycast's Grid API doesn't expose it. Reorder via the action panel or the arrow shortcuts above.
- **No control over title alignment** — `Grid.Item` titles are rendered natively and left-aligned; the API exposes no alignment prop.
- **No in-extension search bar logic** — Raycast's native search filters items by title and keywords automatically.

## Architecture

For implementation notes — the performance/interaction contract, the external store, the synchronous icon-rebuild discipline, the installed-apps fingerprint, and the schema of the imported Launchpad DB — see [CLAUDE.md](./CLAUDE.md).

## License

[MIT](./LICENSE)
