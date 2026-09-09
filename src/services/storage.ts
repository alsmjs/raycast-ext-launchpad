import { LocalStorage } from "@raycast/api";
import { ScanState } from "../core/appScan";
import { migrateConfig } from "../core/migrate";
import { LaunchpadConfig } from "../core/types";

const CONFIG_KEY = "launchpad_config";
/**
 * The scan fingerprint is cache metadata, not user data. Keeping it in its own
 * key means a routine "nothing changed" open doesn't rewrite the whole config
 * blob, and the config schema stays free of bookkeeping fields.
 */
const SCAN_KEY = "launchpad_appscan";

export async function loadConfig(): Promise<LaunchpadConfig | null> {
  const raw = await LocalStorage.getItem<string>(CONFIG_KEY);
  if (!raw) return null;
  try {
    return migrateConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveConfig(config: LaunchpadConfig): Promise<void> {
  await LocalStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export async function loadScanState(): Promise<ScanState | null> {
  const raw = await LocalStorage.getItem<string>(SCAN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.signature !== "string" || typeof parsed?.lastFullScanAt !== "number") return null;
    return parsed as ScanState;
  } catch {
    return null;
  }
}

export async function saveScanState(state: ScanState): Promise<void> {
  await LocalStorage.setItem(SCAN_KEY, JSON.stringify(state));
}
