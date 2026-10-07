# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Raycast extension replacing macOS Launchpad (removed in macOS 26 Tahoe). It displays installed apps in a Grid with user-defined folders, launched via the Raycast keyword `launchpad`.

## Documentation

Always use Context7 when needing library/API documentation, code generation, setup or configuration steps — no explicit prompt required.

**Scope of this file.** It is auto-loaded in full every session, so it holds only what constrains an edit: the interaction contract, the architecture map, the invariants, and the platform traps. That content has to be present *before* work starts — an agent that would think to go and read a separate pitfalls file is already an agent that wasn't going to make the mistake.

Anything narrative, lookup-only, or forward-looking belongs in `docs/` instead. Deferred features, unverified paths and coverage gaps live in [docs/BACKLOG.md](./docs/BACKLOG.md) — read it before starting new work, not before fixing a bug.

## Commands

```bash
npm run dev      # develop with hot-reload inside Raycast
npm run build    # compile and validate (no watch)
npm run lint     # ESLint + Prettier via @raycast/eslint-config
npm run fix-lint # lint + auto-fix
npm test         # vitest, src/core only
```

`npm run dev` requires Raycast to be running. It imports the extension into Raycast and enables hot-reload. Errors surface in Raycast's developer overlay.

**Keep `@raycast/api` in step with the Raycast app.** The CLI inside that package is what builds and registers a dev extension. After the move to the Raycast 2 desktop app the extension stopped working on the 2.2.1 package; upgrading to match the app (2.6.3) and re-running `npm run dev` brought it back with no source changes. The isolation isn't airtight — 2.2.1 still compiled cleanly, and its build was never launched by deeplink before the upgrade — but if the extension breaks after a Raycast update, matching the versions is the first thing to try.

## Performance & Interaction Contract

This is the tie-breaker for every design decision here. It is a deliberate set of trade-offs, not a wish list.

| Situation | Requirement |
| --- | --- |
| **User mutations** — move an app, create/delete a folder, hide, bulk-move | **Exact and instant.** The folder composite icon must be correct in the *same* render as the config change. An icon that catches up a beat later is a bug, not a minor delay. |
| **Hot path** — open the extension → enter a folder → launch an app | **As fast as possible.** No redrawing icons, no rebuilding caches, no re-scanning the system unless something actually changed. |
| **Cache rebuilds** | An occasional perceptible hitch is acceptable and understood. Frequent small ones are not. |
| **General** | Precision first. **No unnecessary async work.** A synchronous `execFileSync` on the render path is the right call when it buys interaction certainty. |

## Architecture

Three layers, split by side-effect boundary — which is also the testability boundary.

```
src/
  launchpad.tsx            command entry (thin; kicks off the load at module scope)
  store.ts                 single source of truth: external store + useSyncExternalStore

  core/                    pure. No @raycast/api, no react, no fs. 100% unit-tested.
    types.ts               LaunchpadConfig / Folder / AppEntry / LaunchOverride / Scope
    mutations.ts           (config, args) => config
    sync.ts                mergeInstalled(config, installed) => config
    migrate.ts             any stored blob → current schema
    dbRows.ts              Launchpad DB row parsing + import layout
    proxy.ts               `scutil --proxy` parsing
    displayNames.ts        `mdls` output parsing (positional, abort-aware)
    appScan.ts             installed-apps fingerprint
    iconCache.ts           folder-composite and app-icon cache keys
    composite.ts           3×3 pixel compositor
    concurrency.ts         mapLimit — bounded parallelism for subprocess batches
    id.ts                  crypto.randomUUID wrapper

  services/                side-effect boundary; one external dependency per file
    proc.ts                execFile wrappers + BIN paths + dev timing/failure logs
    storage.ts             LocalStorage
    applications.ts        getApplications + localizedName + mdls fallback + fingerprint
    launchpadDb.ts         locate and query the system Launchpad DB
    icns.ts                .icns → PNG via plutil + sips (shared by both icon caches)
    appIcon.ts             per-app high-res icons + disk cache (replaces fileIcon)
    folderIcon.ts          composite build + disk cache in supportPath
    launcher.ts            open / open --env / lsappinfo

  ui/                      React. Grids own the store subscription; items take props.
    TopGrid / FolderGrid / AppItem / FolderItem
    MoveToFolderAction / FolderNameForm / GlobalActions / useSelection / mode
```

## The Store (`src/store.ts`)

**Why a module-level store rather than component state.** Raycast's `push()` stores the JSX element it was handed. A pushed screen therefore keeps the props it was created with and never re-renders when its parent's state moves — and a Context provider can't reach it either, because the navigation container renders it outside our tree. The previous design worked around this by having `FolderGrid` hold its own copy of the config and push the whole thing back up on every edit, which meant **a background sync landing while the user was inside a folder got silently reverted by their next action**.

An external store removes the whole class of bug: every screen reads the same state regardless of where it sits in the navigation stack.

`mutate(config => config)` is the **only** way to change the config. It takes an updater, so writing back a stale snapshot is not expressible. It early-returns when the updater hands back the same reference — which is why every function in `core/mutations.ts` returns the input unchanged on a no-op. Holding ⌥⇧← on a first-column app costs nothing: no render, no icon rebuild, no write.

### Folder icons: two functions, deliberately different

- `lookupFolderIcons(folders)` — cache hits only (`existsSync`), zero subprocesses. Used on **first paint and background sync**.
- `computeFolderIconsSync(folders)` — builds on a miss, blocking. Used **only for user mutations**, which is what satisfies the "exact and instant" rule above.

Both **REPLACE** the whole map rather than merging, so a folder that just lost its last app drops out and falls back to `Icon.Folder` on the next frame. `fillMissingIcons` runs the parallel async build **once per session**, at startup only — rebuilding asynchronously mid-edit would repaint cells underneath the user.

## Startup Path

1. `loadConfig()` — LocalStorage read, `migrateConfig` normalizes it. Paint immediately via `lookupFolderIcons`.
2. `syncIfStale()` — **only re-scans when something actually changed** (below).
3. `fillMissingIcons()` — parallel composite builds for cold-cache folders.
4. `pruneIconCache()` — sweep orphaned PNGs.

First-ever launch instead imports from the system Launchpad DB.

### The change fingerprint (`core/appScan.ts` + `services/applications.ts`)

Opening the extension used to run a full `getApplications()` plus an `mdls` batch every single time, even though installing an app happens once a week at most. Now a fingerprint of the app directories — `readdirSync` name lists plus directory mtimes, no subprocess, sub-millisecond — decides whether the scan is needed at all.

Both halves matter: mtime alone misses an in-place swap that preserves the timestamp; names alone miss a rename that keeps the same set.

The fingerprint can't see apps installed outside the standard directories. Two escape hatches keep it honest: the **Rescan Applications** action (`⌘⇧R`, present in every action panel) and an unconditional full scan once every 24h. The fingerprint lives in its own LocalStorage key (`launchpad_appscan`) so a sync-only change doesn't rewrite the config blob.

## Data Model (`src/core/types.ts`)

```ts
LaunchpadConfig {
  version: number
  folders: Folder[]                              // ordered; user-defined
  uncategorized: AppEntry[]                      // new installs land at the start
  hidden: AppEntry[]                             // full entries so unhide can restore name/path
  launchOverrides: Record<string, LaunchOverride> // key = bundleId
}

Folder         { id, name, apps }
AppEntry       { bundleId, name, systemName?, path }
LaunchOverride { injectSystemProxy?, env? }
```

`bundleId` is the primary key. `name` is the localized display name; `systemName` carries the English bundle name **only when it differs**, and feeds `Grid.Item`'s `keywords` so "密码" is still findable by typing "Passwords".

### Display names: `mdls`, not `Application.localizedName`

`Application.localizedName` looks like a free replacement for shelling out to `mdls`. It is not. Measured on a zh-Hans system with 101 apps: it was populated for 74 of them, and **64 of 101 disagreed with `kMDItemDisplayName`** — usually by returning the English bundle name. Preferring it silently dropped Chinese names for most of the grid.

`kMDItemDisplayName` is by definition what Finder and Launchpad display, so it is the source of truth and `localizedName` is only a fallback. The batch costs ~122ms for 101 apps and runs only when the directory fingerprint has moved, which is precisely what made the cheaper-but-wrong source pointless.

**One missing path used to cost every name.** `mdls` given a path that doesn't exist prints an error *to stdout* at that position, stops processing the rest, and exits 1; treating the exit code as all-or-nothing dropped the whole batch and reverted the entire grid to English. LaunchServices — which `getApplications()` reads — keeps registrations for apps in the Trash, abandoned installers and superseded self-updates, so this is not hypothetical. Hence two guards: `listInstalled` drops paths that aren't on disk (before dedupe, so a stale copy can't win over the real one), and the batch runs through `runKeepingPartialOutput` + `core/displayNames.ts`, which keeps everything resolved before an abort and never assigns a name past the point where alignment is lost.

`launchOverrides` is a **top-level map, not a field on `AppEntry`** — on purpose. An `AppEntry` is a projection of system state and gets filtered out when a scan doesn't return the app; an override is user intent and must survive that.

## Ordering Semantics (pinned by tests)

These are muscle memory. Do not "tidy" them.

- Move **into** a folder → appended at the **end**
- Move **out** to the top level → inserted at the **front**
- Newly installed apps → **front** of uncategorized
- Delete a folder → its apps go to the **front** of uncategorized

## Launch Environment Injection

### Why

Discord's updater (`updater.node`, Rust reqwest 0.11 + hyper 0.14) only reads `HTTPS_PROXY`; it ignores the macOS system proxy entirely, so behind a blocked network it hangs at the splash screen. The same applies to anything built on Rust reqwest, Go net/http or Python requests.

### How — `open --env`, not `spawn`

Raycast's `open()` (and `LSOpen` beneath it) hands the app **launchd's** environment, not ours, so nothing can be passed through it. `open(1)` however takes `--env NAME=VALUE`, and the app it launches is owned by launchd rather than being our child.

Verified on this machine:

- `open --env HTTPS_PROXY=… App.app` → the variable is present in the app's environment. Multiple `--env` flags accumulate. The caller's own environment is inherited too.
- End to end with Discord: manifest request returned `Already up to date.` in **376ms** (and 100ms on the retry), against `ConnectError(ConnectionRefused)` without injection.

This is why there is no `plutil`-based `CFBundleExecutable` resolution and no `detached`/`unref` handling — none of it is needed, and LaunchServices semantics (activating an existing window, Dock icon, activation policy, sandbox setup) stay intact.

### The trap

**`open --env` does nothing for an app that is already running — and still exits 0.** The message goes to stderr only. So `services/launcher.ts` checks up front with `lsappinfo info -only pid -app <bundleId>` and returns `"already-running"`; the UI activates the app anyway and offers **Quit & Relaunch**.

Do not use `pgrep -f` for this: BSD `pgrep` does not honour a `^` anchor, and unanchored it matches our own command line.

### Proxy reading

`scutil --proxy`, parsed by `core/proxy.ts`, read fresh on every launch — **never cached**. It is a sub-millisecond local query, and toggling a proxy is routine; a stale value would produce a symptom nobody could trace back to here.

Deliberate behaviours: nothing is injected when no proxy is enabled (a blank value is worse than none — the app would believe a proxy exists and fail); SOCKS-only is **not** degraded into `ALL_PROXY` (support varies too much between HTTP clients); a PAC script is reported as `pacOnly` and surfaced in the UI rather than silently ignored.

### UI

`⌘⇧P` toggles `Enable / Disable System Proxy Injection` on the highlighted app. `⌘P` is unavailable — Raycast reserves it for the search-bar dropdown.

Enabling with no usable proxy **still enables** (the user may be about to start theirs) but shows a loud Failure toast naming what was actually found. Apps with an active override are marked with a `🌐 ` **title prefix** — no extra render node, no change to cell height, and Raycast still substring-matches the name.

There is no Form for custom `KEY=VALUE` variables yet; `LaunchOverride.env` exists in the model and is honoured by the launcher.

## Launchpad DB Import (`services/launchpadDb.ts` + `core/dbRows.ts`)

The DB lives in a per-user temp dir, **not** in `~/Library/Application Support/Dock/`:

```
/private${getconf DARWIN_USER_DIR}com.apple.dock.launchpad/db/db
```

Schema (macOS 15+):

```
items  (rowid, uuid, flags, type, parent_id, ordering)   type 2 = folder, 3 = page, 4 = app
apps   (item_id, title, bundleid, …)
groups (item_id, category_id, title)                     folders; no items_within_groups table
```

Hierarchy is app → page (type 3) → group, so the query joins `items` twice.

**`placed` must only record apps that actually landed in a user folder.** Root pages resolve to Launchpad's own groups (`Default`, `Root`, `HoldingPage`) or to no group at all — 31 of 77 apps on the dev machine. Treating "appeared in the DB" as "placed" made every one of them vanish from the import: in neither a folder nor the top level. This was a real bug; `core/dbRows.test.ts` pins it.

Every failure mode (no DB, incompatible schema, no `sqlite3`) falls back to a flat list of everything installed.

## Deliberate Design — do not "fix" these

Each of these looks like an oversight and is not. Most are pinned by a test.

- **Synchronous `execFileSync` on the mutation path** (`buildFolderIconSync`). Trading throughput for interaction certainty, per the contract above.
- **Async folder-composite builds restricted to startup** (`iconsFilled`). Avoids repainting cells mid-edit. (App icons are exempt — see "App icons" below.)
- **`folderIcons` REPLACE, never merge.** Lets an emptied folder drop its stale composite.
- **`mergeInstalled` removes nothing when the scan comes back empty.** A transient `getApplications()` failure must not wipe the user's layout.
- **`hidden` is never filtered by installed-ness.** `getApplications()` omits some system apps; filtering would make them vanish with no way to unhide.
- **`launchOverrides` is never garbage-collected** for uninstalled apps. Same reasoning: user intent, not system state.
- **`import crypto from "crypto"`** (see `core/id.ts`). Raycast's bundler does not polyfill a global `crypto`.
- **No concurrency cap on first-paint folder composites** (at most nine `sips` per folder, a handful of folders). App icons are a different scale — a hundred bundles — and are capped at 8.
- **`Grid.Inset.Zero` and `composite.PAD` are a pair.** The grid uses no inset so app icons line up with their titles; `inset` is grid-wide, so the folder composite gets its equivalent margin baked into the PNG instead. Reintroducing a grid inset would double the folder's padding; dropping `PAD` would make folders full-bleed and visibly heavier than the app icons beside them. Change one and you must change the other — and bump `ICON_CACHE_VERSION`.
- **`columns={8}` hardcoded**, no `preferences` mechanism.
- **`⌘R` is Rename, not Refresh.** Raycast suggests `Common.Refresh` for `⌘R`; rename predates it here and is used far more often. Rescan takes `⌘⇧R`. There is a targeted eslint-disable with this reason.

## Subprocesses (`services/proc.ts`)

Everything shells out through `run` / `runAsync`: array arguments (no shell), a timeout, and failure-as-null since every caller has a real fallback.

**Always use `BIN.*`, never a bare command name.** Raycast's extension process does **not** have `/usr/sbin` on its PATH. `execFileSync("scutil", …)` fails with ENOENT there, and combined with failure-as-null that surfaced as "no system proxy is configured" while Surge was plainly running — a wrong answer, not an error. Every other tool we call happens to live in `/usr/bin` and worked by luck.

`runKeepingPartialOutput` is the exception to all-or-nothing: for batch tools that fail part-way (see `mdls` above), it returns whatever reached stdout before a non-zero exit.

`run`/`runAsync` log the failure reason when `environment.isDevelopment`. That is what makes an ENOENT distinguishable from a legitimately empty result; without it the bug above needed inference rather than a glance at the log.

## Raycast 2 Runtime

- Commands run as worker threads inside the shared **Raycast Backend** process. Each launch still gets a **fresh module instance** (verified with a probe: `started` was `false` on every launch, same pid), so module-level state in `store.ts` is per-session, as it always was.
- The upgrade moved the old app's data into `~/Library/Application Support/.com.raycast.macos.backups/v1/`. LocalStorage (the layout) was migrated; `supportPath` contents were not, so folder composites rebuilt once on first launch. Expected, and covered by the cache-rebuild clause of the contract.
- **`{ fileIcon }` renders blurry in a grid cell.** Verified side by side: the same app via `fileIcon` vs a PNG extracted from its `.icns` — the former visibly soft, the latter sharp. Hence `services/appIcon.ts` (below). Raycast's own root search shows icons too small to tell.
- Otherwise no API used here changed behaviour in 2.x. The common shortcuts re-bound in 2.0 (`CopyName`, `CopyPath`, `Pin`, `MoveUp/Down`) are not used.

### App icons (`services/appIcon.ts`)

Every app cell renders `{ source: <our PNG> }`, falling back to `fileIcon` only until the PNG exists or for an app with no `.icns`.

- **Size 256.** Confirmed sharp by eye on the dev machine's Retina display. 512 extracts equally fast but costs ~4× the decoded memory on Raycast's side (~100 MB vs ~26 MB for 100 apps). Raise `APP_ICON_SIZE` if it ever reads soft; it is part of the cache key.
- **Keyed on bundle path + `Info.plist` mtime**, so a lookup is one `stat` and never a subprocess, and an app update re-extracts automatically.
- **Looked up at startup and after a sync only.** `mutate` never touches `appIcons` — moving an app doesn't change its icon.
- **Built off the hot path**, 8 at a time (`mapLimit`), tmp-then-rename so a killed run can't leave a truncated PNG that `existsSync` accepts forever. Measured: 103 icons from cold in ~480 ms; an already-warm launch spends ~2 ms here.
- **Negative cache for structural misses only.** An app with no `.icns` gets a `.none` marker so it isn't retried (and a `plutil` spawned) on every launch. A *conversion* failure is not remembered — one bad moment under load must not pin a normal app to the blurry fallback until its next update. `icns.ts` returns `"ok" | "no-icns" | "failed"` precisely so callers can tell these apart.
- Unlike folder composites, filling app icons after startup is fine: it only swaps a placeholder for the sharp version of the same icon, so nothing moves under the user.

## Known Platform Limits

- **Grid columns**: 1–8, enforced by Raycast.
- **No drag-and-drop.** Reordering uses action-panel submenus and `⌥⇧←/→`.
- **Titles cannot be centred.** Checked against the full prop list: `Grid` exposes `actions`, `aspectRatio`, `children`, `columns`, `filtering`, `fit`, `inset`, `isLoading`, `navigationTitle`, `onSearchTextChange`, `onSelectionChange`, `pagination`, `searchBarAccessory`, `searchBarPlaceholder`, `searchText`, `selectedItemId`, `throttle`; `Grid.Item` exposes `content`, `accessory`, `actions`, `id`, `keywords`, `quickLook`, `subtitle`, `title`. The layout props (`aspectRatio` / `columns` / `fit` / `inset`) all shape the **content area**, never text placement. Titles render flush to the cell's left edge and that is fixed by the framework — it is how every Raycast grid looks, including the built-in ones.

  The only route to true centring is baking the text into an SVG `content` and dropping `title`, which breaks search-bar filtering (Raycast indexes `title` and `keywords`) and forces a per-app image composite on the hot path. Considered and rejected.

  What *is* controllable is the apparent skew, and that is worth knowing because it looks like a bug: the title aligns to the cell edge while `inset` pulls the content inward, so any inset shows up as the name sitting visibly left of its icon. `Grid.Inset.Small` reads as badly misaligned; `Grid.Inset.Zero` puts the two edges back together. The residual offset is the icon asset's own internal padding (~10% on macOS), which cannot be stripped from a `fileIcon`.

  The pre-refactor screenshots — `metadata/*.png` as of commit `c3abc27`, before the switch to `Inset.Zero` — show the original skew clearly. Check them in git history before treating left-aligned titles as a regression again.
- **Reserved shortcuts**: `⌘P` (search-bar dropdown), `⌘K`, `⌘A`, `⌘W`, `⌘Q`, `⌘,`, `⌘↵` (auto-assigned to the **second** action in a panel), bare arrows, `escape`. The full list is in `@raycast/eslint-plugin/dist/rules/no-reserved-shortcut.js`.
- `⌘↵` landing on action #2 is why `Move to Folder` is kept in that slot in Apps mode and `Done` in Multi-Move — both are harmless to trigger by reflex.

## Testing

`npm test` covers `src/core` only — that layer imports nothing from Raycast, so it runs under plain Node. `services` and `ui` are side-effect and rendering boundaries, verified by hand in `npm run dev`.

The suite exists primarily to pin the "deliberate design" list above so a future cleanup pass can't quietly undo it.
