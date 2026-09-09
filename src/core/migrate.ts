import { AppEntry, CONFIG_VERSION, Folder, LaunchOverride, LaunchpadConfig } from "./types";

/**
 * Turn whatever came out of LocalStorage into a config we can trust.
 *
 * The stored blob is a plain JSON round-trip with no schema enforcement, and it
 * predates both `version` and `launchOverrides`. Rather than a chain of numbered
 * migration steps, this normalizes defensively: anything unrecognizable is
 * dropped, anything missing gets a default. Returns `null` only when the blob is
 * so broken that a fresh first-run import is the better answer.
 */
export function migrateConfig(raw: unknown): LaunchpadConfig | null {
  if (!isRecord(raw)) return null;

  const folders = asArray(raw.folders).map(toFolder).filter(isPresent);
  const uncategorized = asArray(raw.uncategorized).map(toEntry).filter(isPresent);
  const hidden = asArray(raw.hidden).map(toEntry).filter(isPresent);

  // A blob with none of the three buckets isn't a config we wrote.
  if (!Array.isArray(raw.folders) && !Array.isArray(raw.uncategorized) && !Array.isArray(raw.hidden)) {
    return null;
  }

  return {
    version: CONFIG_VERSION,
    folders,
    uncategorized,
    hidden,
    launchOverrides: toOverrides(raw.launchOverrides),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toEntry(value: unknown): AppEntry | null {
  if (!isRecord(value)) return null;
  const { bundleId, name, path, systemName } = value;
  if (typeof bundleId !== "string" || !bundleId) return null;
  if (typeof name !== "string" || typeof path !== "string") return null;
  const entry: AppEntry = { bundleId, name, path };
  if (typeof systemName === "string" && systemName) entry.systemName = systemName;
  return entry;
}

function toFolder(value: unknown): Folder | null {
  if (!isRecord(value)) return null;
  const { id, name, apps } = value;
  if (typeof id !== "string" || !id || typeof name !== "string") return null;
  return { id, name, apps: asArray(apps).map(toEntry).filter(isPresent) };
}

function toOverrides(value: unknown): Record<string, LaunchOverride> {
  if (!isRecord(value)) return {};
  const out: Record<string, LaunchOverride> = {};
  for (const [bundleId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const override: LaunchOverride = {};
    if (raw.injectSystemProxy === true) override.injectSystemProxy = true;
    if (isRecord(raw.env)) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.env)) if (typeof v === "string") env[k] = v;
      if (Object.keys(env).length > 0) override.env = env;
    }
    if (Object.keys(override).length > 0) out[bundleId] = override;
  }
  return out;
}
