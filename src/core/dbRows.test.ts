import { describe, expect, it } from "vitest";
import { buildImportedLayout, DB_SEPARATOR, parseDbRows } from "./dbRows";
import { InstalledApp } from "./sync";

const installed = (id: string, over: Partial<InstalledApp> = {}): InstalledApp => ({
  bundleId: id,
  name: id,
  localizedName: id,
  path: `/Applications/${id}.app`,
  ...over,
});

const line = (...cols: string[]) => cols.join(DB_SEPARATOR);

let counter = 0;
const newId = () => `id${++counter}`;

describe("parseDbRows", () => {
  it("splits on the ||| separator", () => {
    expect(parseDbRows(line("Code", "Xcode", "com.apple.dt.Xcode"))).toEqual([
      { groupTitle: "Code", appTitle: "Xcode", bundleId: "com.apple.dt.Xcode" },
    ]);
  });

  it('converts the literal string "null" back to a null group', () => {
    expect(parseDbRows(line("null", "Safari", "com.apple.Safari"))[0].groupTitle).toBeNull();
  });

  it("treats an empty group as null", () => {
    expect(parseDbRows(line("", "Safari", "com.apple.Safari"))[0].groupTitle).toBeNull();
  });

  it("skips blank lines and rows with no bundle id", () => {
    const raw = [line("Code", "A", "a"), "", line("Code", "B", ""), line("Code", "C", "c")].join("\n");
    expect(parseDbRows(raw).map((r) => r.bundleId)).toEqual(["a", "c"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseDbRows("")).toEqual([]);
    expect(parseDbRows("   \n  ")).toEqual([]);
  });
});

describe("buildImportedLayout", () => {
  it("groups apps under their user folder", () => {
    const rows = parseDbRows([line("Code", "A", "a"), line("Code", "B", "b")].join("\n"));
    const out = buildImportedLayout(rows, [installed("a"), installed("b")], newId);
    expect(out.folders).toHaveLength(1);
    expect(out.folders[0].name).toBe("Code");
    expect(out.folders[0].apps.map((e) => e.bundleId)).toEqual(["a", "b"]);
    expect(out.uncategorized).toEqual([]);
  });

  // Regression: Launchpad parks unfoldered apps in its own "Default" group (29
  // of 77 apps on the dev machine) or on a page with no group at all. Marking
  // those as "placed" dropped them from the import entirely.
  it("sends apps in system groups to the top level instead of dropping them", () => {
    const rows = parseDbRows(
      [
        line("Code", "A", "a"),
        line("Default", "B", "b"),
        line("null", "C", "c"),
        line("Root", "D", "d"),
        line("HoldingPage", "E", "e"),
      ].join("\n"),
    );
    const out = buildImportedLayout(
      rows,
      ["a", "b", "c", "d", "e"].map((id) => installed(id)),
      newId,
    );
    expect(out.folders.map((f) => f.name)).toEqual(["Code"]);
    expect(out.uncategorized.map((e) => e.bundleId)).toEqual(["b", "c", "d", "e"]);
  });

  it("ignores rows for apps that are not installed", () => {
    const rows = parseDbRows([line("Code", "Gone", "gone"), line("Code", "A", "a")].join("\n"));
    const out = buildImportedLayout(rows, [installed("a")], newId);
    expect(out.folders[0].apps.map((e) => e.bundleId)).toEqual(["a"]);
  });

  it("puts apps missing from the DB at the top level", () => {
    const rows = parseDbRows(line("Code", "A", "a"));
    const out = buildImportedLayout(rows, [installed("a"), installed("fresh")], newId);
    expect(out.uncategorized.map((e) => e.bundleId)).toEqual(["fresh"]);
  });

  it("keeps the localized name and records the English one", () => {
    const rows = parseDbRows(line("Code", "Passwords", "pw"));
    const out = buildImportedLayout(rows, [installed("pw", { name: "Passwords", localizedName: "密码" })], newId);
    expect(out.folders[0].apps[0]).toMatchObject({ name: "密码", systemName: "Passwords" });
  });

  it("places a duplicated row only once", () => {
    const rows = parseDbRows([line("Code", "A", "a"), line("Media", "A", "a")].join("\n"));
    const out = buildImportedLayout(rows, [installed("a")], newId);
    expect(out.folders).toHaveLength(1);
    expect(out.uncategorized).toEqual([]);
  });
});
