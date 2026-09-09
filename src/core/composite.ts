import { PNG } from "pngjs";
import { MAX_ICON_CELLS } from "./iconCache";

/**
 * The 3×3 folder-icon compositor.
 *
 * Lives in `core` because it is pure pixel arithmetic — the only thing the two
 * builders in `services/folderIcon.ts` disagree about is how they obtain the
 * cell buffers (parallel `sips` on first paint, serial `sips` on a user
 * mutation). Sharing the algorithm means a layout change can't drift between
 * the two.
 */

/** Pixels per app icon; larger reads as denser in the grid cell. */
export const CELL = 64;
/** Gap between cells. */
export const GAP = 2;
export const COLS = 3;

/**
 * Transparent margin around the 3×3 block.
 *
 * The grids render with `Grid.Inset.Zero`, which is what lines an app's icon up
 * with its title — but it also means a folder's composite fills the cell edge to
 * edge. Next to app icons that occupy only ~80% of their cell (macOS icon assets
 * carry that much internal padding of their own) a full-bleed composite reads as
 * oversized and heavy.
 *
 * `inset` is a grid-wide prop, so it can't be applied per item. Baking the
 * margin into the PNG gets the same proportions for folders while leaving the
 * apps aligned.
 */
export const PAD = 24;
export const CANVAS = COLS * CELL + (COLS - 1) * GAP + 2 * PAD;

/**
 * `cells` is up to nine PNG buffers already scaled to CELL×CELL, in reading
 * order. A null entry (icon couldn't be extracted) leaves its slot transparent.
 *
 * The canvas is never filled: a fresh PNG buffer is zeroed, i.e. fully
 * transparent, so the Raycast cell background shows through the margin, the gaps
 * and any transparency in the icons themselves.
 */
export function compositeCells(cells: (Buffer | null)[]): Buffer {
  const out = new PNG({ width: CANVAS, height: CANVAS });

  cells.slice(0, MAX_ICON_CELLS).forEach((buffer, i) => {
    if (!buffer) return;

    let src: PNG;
    try {
      src = PNG.sync.read(buffer);
    } catch {
      return; // not a PNG we can read — leave the slot empty
    }

    const ox = PAD + (i % COLS) * (CELL + GAP);
    const oy = PAD + Math.floor(i / COLS) * (CELL + GAP);
    const w = Math.min(src.width, CELL);
    const h = Math.min(src.height, CELL);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = (y * src.width + x) * 4;
        const to = ((oy + y) * CANVAS + (ox + x)) * 4;
        out.data[to] = src.data[from];
        out.data[to + 1] = src.data[from + 1];
        out.data[to + 2] = src.data[from + 2];
        out.data[to + 3] = src.data[from + 3];
      }
    }
  });

  return PNG.sync.write(out);
}
