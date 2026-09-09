import { describe, expect, it } from "vitest";
import { migrateConfig } from "./migrate";
import { CONFIG_VERSION } from "./types";

describe("migrateConfig", () => {
  // The shape that shipped before `version` and `launchOverrides` existed.
  const v1 = {
    folders: [{ id: "f1", name: "Code", apps: [{ bundleId: "a", name: "A", path: "/Applications/A.app" }] }],
    uncategorized: [{ bundleId: "x", name: "X", path: "/Applications/X.app" }],
    hidden: [{ bundleId: "h", name: "H", path: "/Applications/H.app" }],
  };

  it("upgrades a pre-versioning blob without losing anything", () => {
    const out = migrateConfig(v1)!;
    expect(out.version).toBe(CONFIG_VERSION);
    expect(out.launchOverrides).toEqual({});
    expect(out.folders[0].apps.map((a) => a.bundleId)).toEqual(["a"]);
    expect(out.uncategorized.map((a) => a.bundleId)).toEqual(["x"]);
    expect(out.hidden.map((a) => a.bundleId)).toEqual(["h"]);
  });

  it("keeps a current blob intact", () => {
    const out = migrateConfig({
      ...v1,
      version: CONFIG_VERSION,
      launchOverrides: { a: { injectSystemProxy: true, env: { FOO: "1" } } },
    })!;
    expect(out.launchOverrides).toEqual({ a: { injectSystemProxy: true, env: { FOO: "1" } } });
  });

  it("rejects anything that isn't a config", () => {
    expect(migrateConfig(null)).toBeNull();
    expect(migrateConfig("nope")).toBeNull();
    expect(migrateConfig([])).toBeNull();
    expect(migrateConfig({ unrelated: true })).toBeNull();
  });

  it("accepts a partially-written blob and fills in the gaps", () => {
    const out = migrateConfig({ uncategorized: [] })!;
    expect(out).toEqual({
      version: CONFIG_VERSION,
      folders: [],
      uncategorized: [],
      hidden: [],
      launchOverrides: {},
    });
  });

  it("drops malformed entries rather than propagating undefined fields", () => {
    const out = migrateConfig({
      folders: [{ id: "f1", name: "Code", apps: [{ bundleId: "a" }, { name: "no id", path: "/p" }] }, "junk"],
      uncategorized: [
        { bundleId: "", name: "N", path: "/p" },
        { bundleId: "ok", name: "Ok", path: "/p" },
      ],
      hidden: null,
    })!;
    expect(out.folders).toHaveLength(1);
    expect(out.folders[0].apps).toEqual([]);
    expect(out.uncategorized.map((a) => a.bundleId)).toEqual(["ok"]);
    expect(out.hidden).toEqual([]);
  });

  it("normalizes overrides, discarding empty and non-string values", () => {
    const out = migrateConfig({
      ...v1,
      launchOverrides: {
        keep: { injectSystemProxy: true },
        alsoKeep: { env: { A: "1", B: 2 } },
        dropEmpty: {},
        dropFalse: { injectSystemProxy: false },
        dropJunk: "nope",
      },
    })!;
    expect(out.launchOverrides).toEqual({
      keep: { injectSystemProxy: true },
      alsoKeep: { env: { A: "1" } },
    });
  });

  it("preserves systemName when present", () => {
    const out = migrateConfig({
      uncategorized: [{ bundleId: "pw", name: "密码", path: "/p", systemName: "Passwords" }],
    })!;
    expect(out.uncategorized[0].systemName).toBe("Passwords");
  });
});
