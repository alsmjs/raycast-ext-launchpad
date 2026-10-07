import { existsSync } from "fs";
import { join } from "path";
import { BIN, run, runAsync } from "./proc";

/**
 * Extracting an app's icon from its bundle: `plutil` finds the `.icns`, `sips`
 * rasterises it to a PNG at the requested width. Shared by the folder
 * composites (small cells, sync and async) and the per-app icons (async).
 *
 * Every app on the dev machine resolves this way. Apps that only ship an asset
 * catalog (`Assets.car` with no `CFBundleIconFile`) return null, and callers
 * fall back to Raycast's `fileIcon`.
 */

const plutilArgs = (appPath: string) => [
  "-extract",
  "CFBundleIconFile",
  "raw",
  "-o",
  "-",
  join(appPath, "Contents/Info.plist"),
];

const sipsArgs = (icns: string, width: number, out: string) => [
  "-s",
  "format",
  "png",
  icns,
  "--out",
  out,
  "--resampleWidth",
  String(width),
];

function icnsPath(appPath: string, iconFile: string | null): string | null {
  const name = iconFile?.trim();
  if (!name) return null;
  const full = join(appPath, "Contents/Resources", name.endsWith(".icns") ? name : `${name}.icns`);
  return existsSync(full) ? full : null;
}

/**
 * `"no-icns"` is a property of the bundle and will fail the same way next time;
 * `"failed"` is a conversion that went wrong and may well succeed on retry.
 * Callers that cache negative results must only cache the first.
 */
export type IcnsResult = "ok" | "no-icns" | "failed";

/** Writes `out` on "ok"; leaves nothing usable otherwise. */
export function icnsToPngSync(appPath: string, width: number, out: string): IcnsResult {
  const icns = icnsPath(appPath, run(BIN.plutil, plutilArgs(appPath)));
  if (!icns) return "no-icns";
  return run(BIN.sips, sipsArgs(icns, width, out)) !== null ? "ok" : "failed";
}

export async function icnsToPng(appPath: string, width: number, out: string): Promise<IcnsResult> {
  const icns = icnsPath(appPath, await runAsync(BIN.plutil, plutilArgs(appPath)));
  if (!icns) return "no-icns";
  return (await runAsync(BIN.sips, sipsArgs(icns, width, out))) !== null ? "ok" : "failed";
}
