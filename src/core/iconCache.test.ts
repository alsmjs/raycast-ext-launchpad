import { describe, expect, it } from "vitest";
import { appIconKey, folderIconKey, iconSourcePaths, MAX_ICON_CELLS } from "./iconCache";

const paths = (n: number) => Array.from({ length: n }, (_, i) => `/Applications/App${i}.app`);

describe("iconSourcePaths", () => {
  it("keeps at most nine apps — the composite is a 3×3 grid", () => {
    expect(iconSourcePaths(paths(20))).toHaveLength(MAX_ICON_CELLS);
    expect(iconSourcePaths(paths(4))).toHaveLength(4);
  });
});

describe("folderIconKey", () => {
  it("is stable for the same folder and the same order", () => {
    expect(folderIconKey("f1", paths(3))).toBe(folderIconKey("f1", paths(3)));
  });

  // Position-sensitive on purpose: the composite draws these apps in this
  // arrangement, so a reorder has to invalidate it.
  it("changes when the top nine are reordered", () => {
    const [a, b, c] = paths(3);
    expect(folderIconKey("f1", [a, b, c])).not.toBe(folderIconKey("f1", [b, a, c]));
  });

  it("changes when the folder changes, even with identical apps", () => {
    expect(folderIconKey("f1", paths(3))).not.toBe(folderIconKey("f2", paths(3)));
  });

  it("ignores apps beyond the ninth", () => {
    expect(folderIconKey("f1", paths(9))).toBe(folderIconKey("f1", [...paths(9), "/Applications/Extra.app"]));
  });
});

describe("appIconKey", () => {
  const path = "/Applications/Discord.app";

  it("is stable for the same bundle and the same Info.plist", () => {
    expect(appIconKey(path, 1000)).toBe(appIconKey(path, 1000));
  });

  // An app update rewrites Info.plist, so a changed icon gets a new key and is
  // re-extracted rather than served stale.
  it("changes when the app is updated", () => {
    expect(appIconKey(path, 1000)).not.toBe(appIconKey(path, 2000));
  });

  it("differs between apps", () => {
    expect(appIconKey(path, 1000)).not.toBe(appIconKey("/Applications/Safari.app", 1000));
  });
});
