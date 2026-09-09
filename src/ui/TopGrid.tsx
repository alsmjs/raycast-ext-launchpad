import { Action, ActionPanel, Grid, Icon } from "@raycast/api";
import { useState } from "react";
import { unhideAll } from "../core/mutations";
import { Scope } from "../core/types";
import { mutate, useLaunchpad } from "../store";
import { AppItem } from "./AppItem";
import { FolderItem } from "./FolderItem";
import { GlobalActions } from "./GlobalActions";
import { Mode } from "./mode";
import { useSelection } from "./useSelection";

const TOP_LEVEL: Scope = { kind: "uncategorized" };

export function TopGrid() {
  const { config, folderIcons, isSyncing } = useLaunchpad();
  const [mode, setMode] = useState<Mode>("app");
  const selection = useSelection("uncategorized");
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  if (!config) return <Grid isLoading />;

  const isMulti = mode === "multi";

  return (
    <Grid
      columns={8}
      // Zero, not Small: Raycast aligns an item's title to the *cell* edge while
      // `inset` pulls the content inward, so any inset shows up as the title
      // sitting visibly left of the icon. Letting the content fill the cell puts
      // the two edges back together. (macOS icon assets carry their own internal
      // padding, so a little offset remains and can't be removed for fileIcons.)
      inset={Grid.Inset.Zero}
      isLoading={isSyncing}
      // See FolderGrid: keeps the cursor on an app after a reorder.
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id ?? undefined)}
      navigationTitle={
        isMulti ? `Multi-Move${selection.count > 0 ? ` — ${selection.count} selected` : ""}` : "Launchpad"
      }
      searchBarPlaceholder={isMulti ? "Select apps to bulk-move…" : "Search apps…"}
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="Mode"
          value={mode}
          onChange={(value) => {
            if (value !== mode) selection.clear();
            setMode(value as Mode);
          }}
        >
          <Grid.Dropdown.Item title="Apps" value="app" />
          <Grid.Dropdown.Item title="Multi-Move" value="multi" />
        </Grid.Dropdown>
      }
      actions={
        <ActionPanel>
          <GlobalActions />
        </ActionPanel>
      }
    >
      {config.folders.length > 0 && (
        <Grid.Section title="Folders">
          {config.folders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              mode={mode}
              iconPath={folderIcons[folder.id]}
              // Entering a folder in Multi-Move moves the selection scope with it.
              onOpen={selection.clear}
            />
          ))}
        </Grid.Section>
      )}

      {config.uncategorized.length > 0 && (
        <Grid.Section title="Apps">
          {config.uncategorized.map((app) => (
            <AppItem
              key={app.bundleId}
              app={app}
              scope={TOP_LEVEL}
              mode={mode}
              config={config}
              selection={selection}
              onDone={() => {
                selection.clear();
                setMode("app");
              }}
            />
          ))}
        </Grid.Section>
      )}

      {config.hidden.length > 0 && (
        <Grid.Section title="">
          <Grid.Item
            id="hidden"
            title={`${config.hidden.length} hidden ${config.hidden.length === 1 ? "app" : "apps"}`}
            content={Icon.Eye}
            actions={
              <ActionPanel>
                <Action title="Unhide All" icon={Icon.Eye} onAction={() => mutate(unhideAll)} />
                <GlobalActions />
              </ActionPanel>
            }
          />
        </Grid.Section>
      )}

      {config.folders.length === 0 && config.uncategorized.length === 0 && <Grid.EmptyView title="No apps yet" />}
    </Grid>
  );
}
