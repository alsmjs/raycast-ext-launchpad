import { Grid, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { Scope } from "../core/types";
import { useLaunchpad } from "../store";
import { AppItem } from "./AppItem";
import { Mode, pluralizeApps } from "./mode";
import { useSelection } from "./useSelection";

/**
 * A folder's contents.
 *
 * Note what isn't here: a local copy of the config. This screen reads the same
 * store as the top-level grid, so a background sync that lands while the user is
 * in here shows up immediately instead of being clobbered by their next edit.
 */
export function FolderGrid({ folderId, mode }: { folderId: string; mode: Mode }) {
  const { pop } = useNavigation();
  const { config, appIcons } = useLaunchpad();
  const selection = useSelection(folderId);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  const folder = config?.folders.find((f) => f.id === folderId);

  // Deleting the folder from underneath this screen (or uninstalling its last
  // app during a sync) leaves nothing to show. Popping has to happen as an
  // effect, not during render.
  useEffect(() => {
    if (config && !folder) pop();
  }, [config, folder]);

  if (!config || !folder) return <Grid />;

  const scope: Scope = { kind: "folder", folderId };
  const isMulti = mode === "multi";

  return (
    <Grid
      columns={8}
      inset={Grid.Inset.Zero} // see TopGrid for why Zero
      // Tracking the selected id (rather than letting Raycast track an index)
      // keeps the cursor on an app after ⌥⇧← / ⌥⇧→ move it.
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id ?? undefined)}
      navigationTitle={
        isMulti ? `${folder.name} — Multi-Move${selection.count > 0 ? ` (${selection.count})` : ""}` : folder.name
      }
      searchBarPlaceholder={isMulti ? `Select apps in ${folder.name} to bulk-move…` : `Search ${folder.name}…`}
    >
      <Grid.Section title={folder.name} subtitle={pluralizeApps(folder.apps.length)}>
        {folder.apps.map((app) => (
          <AppItem
            key={app.bundleId}
            app={app}
            iconPath={appIcons[app.path]}
            scope={scope}
            mode={mode}
            config={config}
            selection={selection}
            onDone={() => {
              selection.clear();
              pop();
            }}
          />
        ))}
      </Grid.Section>
    </Grid>
  );
}
