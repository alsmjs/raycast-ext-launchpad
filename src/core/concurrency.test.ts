import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("mapLimit", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapLimit([30, 1, 20, 5], 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms * 2;
    });
    expect(out).toEqual([60, 2, 40, 10]);
  });

  it("never has more than `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        peak = Math.max(peak, ++inFlight);
        await tick();
        inFlight--;
      },
    );
    expect(peak).toBe(3);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapLimit([], 8, async (x) => x)).toEqual([]);
    expect(await mapLimit([1, 2], 8, async (x) => x + 1)).toEqual([2, 3]);
  });
});
