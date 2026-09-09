import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { CANVAS, CELL, compositeCells, GAP, PAD } from "./composite";

/** A solid CELL×CELL square of the given colour. */
function solid(r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: CELL, height: CELL });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

const RED = solid(255, 0, 0);
const GREEN = solid(0, 255, 0);
const BLUE = solid(0, 0, 255);

describe("compositeCells", () => {
  /** Top-left pixel of cell `i`, in reading order. */
  const cellOrigin = (i: number): [number, number] => [
    PAD + (i % 3) * (CELL + GAP),
    PAD + Math.floor(i / 3) * (CELL + GAP),
  ];

  it("produces a square canvas of the expected size", () => {
    const png = PNG.sync.read(compositeCells([RED]));
    expect(png.width).toBe(CANVAS);
    expect(png.height).toBe(CANVAS);
    expect(CANVAS).toBe(3 * CELL + 2 * GAP + 2 * PAD);
  });

  it("lays cells out in reading order, offset by the margin", () => {
    const png = PNG.sync.read(compositeCells([RED, GREEN, BLUE]));
    expect(pixel(png, ...cellOrigin(0))).toEqual([255, 0, 0, 255]);
    expect(pixel(png, ...cellOrigin(1))).toEqual([0, 255, 0, 255]);
    expect(pixel(png, ...cellOrigin(2))).toEqual([0, 0, 255, 255]);
  });

  it("wraps onto the next row after three cells", () => {
    const png = PNG.sync.read(compositeCells([RED, RED, RED, GREEN]));
    expect(pixel(png, ...cellOrigin(3))).toEqual([0, 255, 0, 255]);
  });

  // The margin is what keeps a folder from looking oversized next to the app
  // icons, now that the grid renders with Grid.Inset.Zero.
  it("leaves a transparent margin on every side", () => {
    const png = PNG.sync.read(compositeCells(Array(9).fill(RED)));
    expect(PAD).toBeGreaterThan(0);
    expect(pixel(png, 0, 0)[3]).toBe(0);
    expect(pixel(png, PAD - 1, PAD - 1)[3]).toBe(0);
    expect(pixel(png, CANVAS - 1, CANVAS - 1)[3]).toBe(0);
    expect(pixel(png, ...cellOrigin(0))[3]).toBe(255);
  });

  it("leaves the gaps fully transparent", () => {
    const png = PNG.sync.read(compositeCells(Array(9).fill(RED)));
    expect(pixel(png, PAD + CELL, PAD)[3]).toBe(0);
    expect(pixel(png, PAD, PAD + CELL)[3]).toBe(0);
  });

  it("leaves unfilled slots transparent", () => {
    const png = PNG.sync.read(compositeCells([RED]));
    expect(pixel(png, ...cellOrigin(1))[3]).toBe(0);
    expect(pixel(png, ...cellOrigin(3))[3]).toBe(0);
  });

  it("skips a null cell without shifting the ones after it", () => {
    const png = PNG.sync.read(compositeCells([null, GREEN]));
    expect(pixel(png, ...cellOrigin(0))[3]).toBe(0);
    expect(pixel(png, ...cellOrigin(1))).toEqual([0, 255, 0, 255]);
  });

  it("skips an unreadable buffer rather than throwing", () => {
    const png = PNG.sync.read(compositeCells([Buffer.from("not a png"), GREEN]));
    expect(pixel(png, ...cellOrigin(0))[3]).toBe(0);
    expect(pixel(png, ...cellOrigin(1))).toEqual([0, 255, 0, 255]);
  });

  it("ignores anything past the ninth cell", () => {
    const png = PNG.sync.read(compositeCells([...Array(9).fill(RED), GREEN]));
    expect(pixel(png, ...cellOrigin(8))).toEqual([255, 0, 0, 255]);
  });

  it("returns a fully transparent canvas when given nothing", () => {
    const png = PNG.sync.read(compositeCells([]));
    expect(png.data.every((byte) => byte === 0)).toBe(true);
  });
});
