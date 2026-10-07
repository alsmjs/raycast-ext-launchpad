import { describe, expect, it } from "vitest";
import { parseDisplayNames } from "./displayNames";

const CALC = "/System/Applications/Calculator.app";
const GONE = "/Applications/Gone.app";
const CHESS = "/System/Applications/Chess.app";

describe("parseDisplayNames", () => {
  it("maps each line to its path and strips the .app suffix", () => {
    const raw = 'kMDItemDisplayName = "计算器.app"\nkMDItemDisplayName = "国际象棋.app"\n';
    expect(parseDisplayNames(raw, [CALC, CHESS])).toEqual(
      new Map([
        [CALC, "计算器"],
        [CHESS, "国际象棋"],
      ]),
    );
  });

  it("keeps names that don't end in .app", () => {
    expect(parseDisplayNames('kMDItemDisplayName = "Xcode"\n', [CALC]).get(CALC)).toBe("Xcode");
  });

  it("leaves a (null) answer unset without shifting the ones after it", () => {
    const raw = 'kMDItemDisplayName = (null)\nkMDItemDisplayName = "国际象棋.app"\n';
    const names = parseDisplayNames(raw, [CALC, CHESS]);
    expect(names.has(CALC)).toBe(false);
    expect(names.get(CHESS)).toBe("国际象棋");
  });

  // Regression: verbatim output for [Calculator, <missing>, Chess]. mdls aborts
  // at the missing path and exits 1. The previous implementation discarded the
  // whole batch on the exit code, which silently reverted every app in the grid
  // to its English name.
  it("keeps what mdls resolved before aborting on a missing path", () => {
    const raw = `kMDItemDisplayName = "计算器.app"\n${CALC}: could not find ${GONE}.\n`;
    const names = parseDisplayNames(raw, [CALC, GONE, CHESS]);
    expect(names).toEqual(new Map([[CALC, "计算器"]]));
  });

  it("never assigns a name to the wrong app once alignment is lost", () => {
    // If a stray line ever appeared mid-stream, everything after it is suspect.
    const raw = 'kMDItemDisplayName = "计算器.app"\nsomething unexpected\nkMDItemDisplayName = "国际象棋.app"\n';
    const names = parseDisplayNames(raw, [CALC, GONE, CHESS]);
    expect(names.get(CALC)).toBe("计算器");
    expect(names.has(CHESS)).toBe(false);
  });

  it("handles empty output and surplus lines", () => {
    expect(parseDisplayNames("", [CALC]).size).toBe(0);
    expect(parseDisplayNames('kMDItemDisplayName = "计算器.app"\nkMDItemDisplayName = "x"\n', [CALC]).size).toBe(1);
  });
});
