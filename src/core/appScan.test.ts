import { describe, expect, it } from "vitest";
import { appScanSignature, DirSnapshot, FULL_SCAN_INTERVAL_MS, needsFullScan } from "./appScan";

const snap = (dir: string, mtimeMs: number, appNames: string[]): DirSnapshot => ({ dir, mtimeMs, appNames });

describe("appScanSignature", () => {
  const base = [snap("/Applications", 100, ["A.app", "B.app"]), snap("/System/Applications", 50, ["C.app"])];

  it("is stable across directory and name ordering", () => {
    const shuffled = [snap("/System/Applications", 50, ["C.app"]), snap("/Applications", 100, ["B.app", "A.app"])];
    expect(appScanSignature(shuffled)).toBe(appScanSignature(base));
  });

  it("changes when an app appears", () => {
    const added = [snap("/Applications", 100, ["A.app", "B.app", "New.app"]), base[1]];
    expect(appScanSignature(added)).not.toBe(appScanSignature(base));
  });

  it("changes when an app is renamed but the count stays the same", () => {
    const renamed = [snap("/Applications", 100, ["A.app", "Renamed.app"]), base[1]];
    expect(appScanSignature(renamed)).not.toBe(appScanSignature(base));
  });

  it("changes when only the mtime moves — an in-place replacement", () => {
    const touched = [snap("/Applications", 999, ["A.app", "B.app"]), base[1]];
    expect(appScanSignature(touched)).not.toBe(appScanSignature(base));
  });

  it("does not let one directory's names bleed into another's", () => {
    const a = [snap("/x", 0, ["A.app", "B.app"]), snap("/y", 0, [])];
    const b = [snap("/x", 0, ["A.app"]), snap("/y", 0, ["B.app"])];
    expect(appScanSignature(a)).not.toBe(appScanSignature(b));
  });
});

describe("needsFullScan", () => {
  const state = { signature: "sig", lastFullScanAt: 1_000_000 };

  it("scans when there is no previous state", () => {
    expect(needsFullScan(null, "sig", 1_000_000)).toBe(true);
  });

  it("scans when the fingerprint moved", () => {
    expect(needsFullScan(state, "different", 1_000_000)).toBe(true);
  });

  it("skips the scan when nothing changed", () => {
    expect(needsFullScan(state, "sig", state.lastFullScanAt + 1000)).toBe(false);
  });

  // The fingerprint can't see apps installed outside the standard directories,
  // so it expires on its own rather than being trusted forever.
  it("scans anyway once the fingerprint is a day old", () => {
    expect(needsFullScan(state, "sig", state.lastFullScanAt + FULL_SCAN_INTERVAL_MS)).toBe(true);
  });
});
