import { describe, expect, it } from "vitest";
import { dedupeInstalled, equalConfig, InstalledApp, mergeInstalled } from "./sync";
import { AppEntry, LaunchpadConfig } from "./types";

const entry = (id: string, over: Partial<AppEntry> = {}): AppEntry => ({
  bundleId: id,
  name: id,
  path: `/Applications/${id}.app`,
  ...over,
});

const installed = (id: string, over: Partial<InstalledApp> = {}): InstalledApp => ({
  bundleId: id,
  name: id,
  localizedName: id,
  path: `/Applications/${id}.app`,
  ...over,
});

function base(): LaunchpadConfig {
  return {
    version: 2,
    folders: [{ id: "f1", name: "Code", apps: [entry("a"), entry("b")] }],
    uncategorized: [entry("x")],
    hidden: [entry("h")],
    launchOverrides: { a: { injectSystemProxy: true } },
  };
}

describe("dedupeInstalled", () => {
  it("keeps the first occurrence of a duplicated bundleId", () => {
    const out = dedupeInstalled([
      installed("dup", { path: "/Applications/dup.app" }),
      installed("dup", { path: "/Users/me/Downloads/dup.app" }),
      installed("other"),
    ]);
    expect(out.map((a) => a.path)).toEqual(["/Applications/dup.app", "/Applications/other.app"]);
  });

  it("drops entries without a bundleId", () => {
    expect(dedupeInstalled([installed(""), installed("ok")]).map((a) => a.bundleId)).toEqual(["ok"]);
  });
});

describe("mergeInstalled", () => {
  const all = [installed("a"), installed("b"), installed("x"), installed("h")];

  it("returns the same reference when nothing changed", () => {
    const config = base();
    expect(mergeInstalled(config, all)).toBe(config);
  });

  it("prepends newly installed apps to the top level", () => {
    const next = mergeInstalled(base(), [...all, installed("new")]);
    expect(next.uncategorized.map((a) => a.bundleId)).toEqual(["new", "x"]);
  });

  it("removes uninstalled apps from folders and the top level", () => {
    const next = mergeInstalled(base(), [installed("a"), installed("h")]);
    expect(next.folders[0].apps.map((a) => a.bundleId)).toEqual(["a"]);
    expect(next.uncategorized).toEqual([]);
  });

  // Safety net 1 — an empty scan must not be read as "nothing is installed".
  it("changes nothing when the scan comes back empty", () => {
    const config = base();
    expect(mergeInstalled(config, [])).toBe(config);
  });

  // Safety net 2 — getApplications() omits some system apps; filtering would
  // make them disappear with no way to unhide them.
  it("never drops hidden apps, even when the scan doesn't list them", () => {
    const next = mergeInstalled(base(), [installed("a"), installed("b"), installed("x")]);
    expect(next.hidden.map((a) => a.bundleId)).toEqual(["h"]);
  });

  // Safety net 3 — overrides are user intent, not a projection of system state.
  it("keeps launch overrides for apps that are no longer installed", () => {
    const next = mergeInstalled(base(), [installed("x")]);
    expect(next.folders[0].apps).toEqual([]);
    expect(next.launchOverrides).toEqual({ a: { injectSystemProxy: true } });
  });

  it("refreshes name and path after an update or rename", () => {
    const next = mergeInstalled(base(), [
      installed("a", { name: "Renamed", localizedName: "Renamed", path: "/Applications/Renamed.app" }),
      installed("b"),
      installed("x"),
      installed("h"),
    ]);
    expect(next.folders[0].apps[0]).toEqual({
      bundleId: "a",
      name: "Renamed",
      path: "/Applications/Renamed.app",
    });
  });

  it("stores the English name as systemName only when it differs", () => {
    const next = mergeInstalled(base(), [
      installed("a", { name: "Passwords", localizedName: "密码" }),
      installed("b"),
      installed("x"),
      installed("h"),
    ]);
    expect(next.folders[0].apps[0]).toMatchObject({ name: "密码", systemName: "Passwords" });
    expect(next.folders[0].apps[1].systemName).toBeUndefined();
  });

  it("collapses duplicate installs instead of creating duplicate grid entries", () => {
    const next = mergeInstalled(base(), [...all, installed("new"), installed("new", { path: "/dup.app" })]);
    expect(next.uncategorized.map((a) => a.bundleId)).toEqual(["new", "x"]);
  });
});

describe("equalConfig", () => {
  it("detects folder, ordering and override differences", () => {
    const a = base();
    expect(equalConfig(a, base())).toBe(true);
    expect(equalConfig(a, { ...a, folders: [{ ...a.folders[0], name: "Dev" }] })).toBe(false);
    expect(equalConfig(a, { ...a, uncategorized: [] })).toBe(false);
    expect(equalConfig(a, { ...a, launchOverrides: {} })).toBe(false);
    expect(equalConfig(a, { ...a, launchOverrides: { a: { injectSystemProxy: true, env: { X: "1" } } } })).toBe(false);
  });
});
