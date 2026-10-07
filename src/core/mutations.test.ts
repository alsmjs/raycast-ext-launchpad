import { describe, expect, it } from "vitest";
import {
  createFolder,
  deleteFolder,
  hideApps,
  moveApps,
  moveFolder,
  renameFolder,
  reorderApp,
  setLaunchOverride,
  toggleSystemProxyInjection,
  unhideAll,
} from "./mutations";
import { AppEntry, LaunchpadConfig } from "./types";

const app = (id: string): AppEntry => ({ bundleId: id, name: id, path: `/Applications/${id}.app` });
const ids = (entries: AppEntry[]) => entries.map((e) => e.bundleId);

function base(): LaunchpadConfig {
  return {
    version: 2,
    folders: [
      { id: "f1", name: "Code", apps: [app("a"), app("b")] },
      { id: "f2", name: "Media", apps: [app("c")] },
    ],
    uncategorized: [app("x"), app("y"), app("z")],
    hidden: [app("h")],
    launchOverrides: {},
  };
}

describe("moveApps", () => {
  it("appends to the END when moving into a folder", () => {
    const next = moveApps(base(), ["x"], { kind: "folder", folderId: "f1" });
    expect(ids(next.folders[0].apps)).toEqual(["a", "b", "x"]);
    expect(ids(next.uncategorized)).toEqual(["y", "z"]);
  });

  it("inserts at the FRONT when moving out to the top level", () => {
    const next = moveApps(base(), ["a"], { kind: "uncategorized" });
    expect(ids(next.uncategorized)).toEqual(["a", "x", "y", "z"]);
    expect(ids(next.folders[0].apps)).toEqual(["b"]);
  });

  it("appends the new folder after the existing ones", () => {
    const next = moveApps(base(), ["x", "z"], { kind: "newFolder", folderId: "f3", name: "New" });
    expect(next.folders.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(ids(next.folders[2].apps)).toEqual(["x", "z"]);
    expect(ids(next.uncategorized)).toEqual(["y"]);
  });

  it("keeps the visual order of a multi-selection", () => {
    const next = moveApps(base(), ["z", "x"], { kind: "folder", folderId: "f2" });
    expect(ids(next.folders[1].apps)).toEqual(["c", "x", "z"]);
  });

  it("moves apps between folders", () => {
    const next = moveApps(base(), ["a"], { kind: "folder", folderId: "f2" });
    expect(ids(next.folders[0].apps)).toEqual(["b"]);
    expect(ids(next.folders[1].apps)).toEqual(["c", "a"]);
  });

  it("never touches hidden apps — they are not movable", () => {
    const config = base();
    expect(moveApps(config, ["h"], { kind: "uncategorized" })).toBe(config);
  });

  it("is a no-op for an unknown target folder rather than dropping the apps", () => {
    const config = base();
    expect(moveApps(config, ["x"], { kind: "folder", folderId: "nope" })).toBe(config);
  });

  it("is a no-op for an empty or unmatched selection", () => {
    const config = base();
    expect(moveApps(config, [], { kind: "uncategorized" })).toBe(config);
    expect(moveApps(config, ["nope"], { kind: "uncategorized" })).toBe(config);
  });
});

describe("reorderApp", () => {
  it("swaps within the top level", () => {
    const next = reorderApp(base(), { kind: "uncategorized" }, "y", -1);
    expect(ids(next.uncategorized)).toEqual(["y", "x", "z"]);
  });

  it("swaps within a folder", () => {
    const next = reorderApp(base(), { kind: "folder", folderId: "f1" }, "a", 1);
    expect(ids(next.folders[0].apps)).toEqual(["b", "a"]);
  });

  it("returns the same reference at either edge", () => {
    const config = base();
    expect(reorderApp(config, { kind: "uncategorized" }, "x", -1)).toBe(config);
    expect(reorderApp(config, { kind: "uncategorized" }, "z", 1)).toBe(config);
    expect(reorderApp(config, { kind: "folder", folderId: "nope" }, "a", 1)).toBe(config);
  });
});

describe("hideApps / unhideAll", () => {
  it("appends to hidden and removes from every bucket", () => {
    const next = hideApps(base(), ["x", "a"]);
    expect(ids(next.hidden)).toEqual(["h", "x", "a"]);
    expect(ids(next.uncategorized)).toEqual(["y", "z"]);
    expect(ids(next.folders[0].apps)).toEqual(["b"]);
  });

  it("unhides everything to the FRONT of the top level", () => {
    const next = unhideAll(base());
    expect(ids(next.uncategorized)).toEqual(["h", "x", "y", "z"]);
    expect(next.hidden).toEqual([]);
  });

  it("returns the same reference when there is nothing hidden", () => {
    const config = { ...base(), hidden: [] };
    expect(unhideAll(config)).toBe(config);
  });
});

describe("folder mutations", () => {
  it("returns a deleted folder's apps to the FRONT of the top level", () => {
    const next = deleteFolder(base(), "f1");
    expect(next.folders.map((f) => f.id)).toEqual(["f2"]);
    expect(ids(next.uncategorized)).toEqual(["a", "b", "x", "y", "z"]);
  });

  it("appends new folders", () => {
    const next = createFolder(base(), "f3", "New");
    expect(next.folders.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(next.folders[2].apps).toEqual([]);
  });

  it("renames, and no-ops on an unchanged or unknown name", () => {
    const config = base();
    expect(renameFolder(config, "f1", "Dev").folders[0].name).toBe("Dev");
    expect(renameFolder(config, "f1", "Code")).toBe(config);
    expect(renameFolder(config, "nope", "Dev")).toBe(config);
  });

  it("reorders folders and no-ops at the edges", () => {
    const config = base();
    expect(moveFolder(config, "f2", -1).folders.map((f) => f.id)).toEqual(["f2", "f1"]);
    expect(moveFolder(config, "f1", -1)).toBe(config);
    expect(moveFolder(config, "f2", 1)).toBe(config);
  });
});

describe("launch overrides", () => {
  it("toggles system proxy injection on and off again, removing the empty key", () => {
    const on = toggleSystemProxyInjection(base(), "com.hnc.Discord");
    expect(on.launchOverrides["com.hnc.Discord"]).toEqual({ injectSystemProxy: true });

    const off = toggleSystemProxyInjection(on, "com.hnc.Discord");
    expect(off.launchOverrides).toEqual({});
  });

  it("keeps custom env when the proxy flag is switched off", () => {
    const withEnv = setLaunchOverride(base(), "app", { injectSystemProxy: true, env: { FOO: "1" } });
    const off = toggleSystemProxyInjection(withEnv, "app");
    expect(off.launchOverrides["app"]).toEqual({ injectSystemProxy: false, env: { FOO: "1" } });
  });

  // The UI keys the toggle on `injectSystemProxy`, not on "any override", so for
  // an env-only app the first press must turn the proxy ON and keep the env.
  it("turns the proxy on for an app that only has custom env", () => {
    const envOnly = setLaunchOverride(base(), "app", { env: { FOO: "1" } });
    const on = toggleSystemProxyInjection(envOnly, "app");
    expect(on.launchOverrides["app"]).toEqual({ env: { FOO: "1" }, injectSystemProxy: true });
  });

  it("treats an all-empty override as removal", () => {
    const config = base();
    expect(setLaunchOverride(config, "app", { injectSystemProxy: false })).toBe(config);
    expect(setLaunchOverride(config, "app", { env: {} })).toBe(config);
    expect(setLaunchOverride(config, "app", null)).toBe(config);
  });
});
