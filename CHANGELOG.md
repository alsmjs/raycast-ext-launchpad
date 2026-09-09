# Launchpad Changelog

## [Unreleased]

### Added

- **Per-app system proxy injection.** `⌘⇧P` on any app toggles `Enable / Disable System Proxy Injection`. The app is then launched via `open --env` with `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` read fresh from `scutil --proxy`. This exists for apps that ignore the macOS system proxy and only read environment variables — Discord's updater (Rust reqwest) is the motivating case. Apps with injection enabled are marked with a `🌐` prefix.
- Environment variables only apply at process start, so opening an app that is already running reports it and offers **Quit & Relaunch** instead of pretending it worked.
- **Rescan Applications** (`⌘⇧R`) to force a full re-scan.
- Apps with localized names are now searchable by their English name too.

### Fixed

- **First-run import dropped every app that wasn't inside a folder.** Apps in Launchpad's own `Default` group or on a page with no group (31 of 77 on the dev machine) ended up in neither a folder nor the top level.
- **A background sync could be silently reverted.** Editing inside a folder wrote back a config snapshot taken when the folder was opened, undoing anything the sync had picked up in the meantime.
- Duplicate installs of the same app (a copy in `~/Downloads`, an Xcode beta) no longer produce duplicate grid entries.
- The cursor now stays on an app after moving it with `⌥⇧←` / `⌥⇧→`.

### Changed

- **Opening the extension no longer re-scans the system every time.** A fingerprint of the application directories decides whether a scan is needed; unchanged means no `getApplications()`, no `mdls`, no write.
- **Folder icons are cached in the extension's support directory** instead of the temp directory, so they survive reboots. Orphaned composites are swept on startup.
- Grid items no longer use an inset. Raycast aligns a title to the cell edge while an inset pulls the icon inward, so the inset was showing up as the name sitting visibly left of its icon. Folder composites carry their own margin instead, keeping their previous proportions.
- Upgraded to `@raycast/api` 2.2.1.
- Rewritten around a single external store with a pure, unit-tested core (88 tests). ESLint and Prettier are now actually installed and enforced.

## [Initial Release] - {PR_MERGE_DATE}

- Browse and launch installed macOS apps in a grid view
- Organize apps into custom folders
- Multi-select mode for bulk moves
- Hide/unhide apps
- Localized app names (respects system language)
- Folder icons composed from contained app icons
- First-run import from macOS Launchpad database
