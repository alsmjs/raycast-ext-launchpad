# Backlog

Deferred work and thin spots in verification. Read this when picking up new work
on the extension; it is deliberately **not** in `CLAUDE.md`, which is
auto-loaded every session and reserved for rules that constrain edits.

Last reviewed: 2026-09-10.

## Deliberately deferred features

Each of these was discussed and consciously left out — they are choices, not
oversights. Reopen only if the need actually shows up.

- **UI for custom `KEY=VALUE` launch variables.** `LaunchOverride.env` exists in
  the model and `services/launcher.ts` already injects it; there is simply no
  Form to edit it. The real need was the system proxy, which `⌘⇧P` covers. A
  Form would add a screen whose only user is a hypothetical one.
- **Per-app unhide.** Only "Unhide All" exists. Adding per-app unhide means a
  browsable hidden-apps screen. The hidden bucket is intended as a
  set-and-forget dump for clutter, so the UI cost has not been worth it.
- **Grid columns as a preference.** `columns={8}` is hardcoded. Making it
  configurable drags in the whole `preferences` manifest mechanism for something
  that would be changed once.

## Unverified paths

Not known to be broken — just never exercised, so treat with suspicion if
something looks wrong nearby.

- **First-run import, live in the extension.** `services/launchpadDb.ts` →
  `core/dbRows.ts` has only ever run via unit tests and via `sqlite3` by hand.
  Exercising it for real means clearing the extension's LocalStorage, which
  would discard the maintainer's own layout. Left for whoever forks the
  extension and gets a genuine first run.

  The bug it fixes is worth knowing about: Launchpad parks unfoldered apps in
  its own `Default` group or on a group-less page (31 of 77 apps on the dev
  machine), and an earlier version treated "appeared in the DB" as "placed",
  dropping every one of them. `core/dbRows.test.ts` pins it.
- **Quit & Relaunch.** The "already running — proxy not injected" toast is
  confirmed. The click-through — AppleScript quit, `lsappinfo` polling, the 6s
  timeout, then relaunch — has had at most one manual run and no automated
  coverage.
- **Multi-Move item appearance.** Selected items switched from a `subtitle`
  ("✓ selected") to `accessory={{ icon: Icon.CheckCircle }}`, which has not been
  looked at since the grid moved to `Grid.Inset.Zero`.

## Known gaps in coverage

- `src/services` and `src/ui` have no automated tests, by design: they are the
  side-effect and rendering boundaries, and Raycast's runtime isn't available
  under vitest. The consequence is that whole classes of failure only surface in
  actual use — the `scutil` ENOENT bug is the worked example. Where a type can
  close the hole instead, prefer that (see `BinPath` in `services/proc.ts`).

## Store metadata

`metadata/*.png` are stale: they were taken with `Grid.Inset.Small` and the
pre-margin folder composite, so they no longer match the UI. Left alone on
purpose — the extension is being shared via GitHub rather than the Raycast
Store for now (Store review is badly backlogged), and there is no point guessing
at screenshot requirements that may have changed by the time it is submitted.

Note that `CLAUDE.md` cites these files as historical evidence of the original
title skew, pointing at commit `c3abc27` rather than the working tree — so
regenerating them later is safe.
