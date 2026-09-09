import { Action, ActionPanel, Grid, Icon, Image, Keyboard, useNavigation } from "@raycast/api";
import { newId } from "../core/id";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "../core/mutations";
import { Folder } from "../core/types";
import { mutate } from "../store";
import { FolderGrid } from "./FolderGrid";
import { FolderNameForm } from "./FolderNameForm";
import { GlobalActions } from "./GlobalActions";
import { Mode, pluralizeApps } from "./mode";

export function FolderItem({
  folder,
  mode,
  iconPath,
  onOpen,
}: {
  folder: Folder;
  mode: Mode;
  /** Composite 3×3 PNG, when one has been built for this folder's current apps. */
  iconPath: string | undefined;
  onOpen: () => void;
}) {
  const { push } = useNavigation();

  const open = () => {
    onOpen();
    push(<FolderGrid folderId={folder.id} mode={mode} />);
  };

  return (
    <Grid.Item
      id={folder.id}
      title={folder.name}
      content={folderContent(folder, iconPath)}
      subtitle={pluralizeApps(folder.apps.length)}
      actions={
        <ActionPanel>
          <Action title="Open Folder" icon={Icon.Folder} onAction={open} />

          {/* In Multi-Move a folder is purely a navigation target — entering it
              switches the selection scope to that folder's apps. */}
          {mode === "app" && (
            <>
              <ActionPanel.Section title="Organize">
                <Action
                  title="Rename Folder"
                  icon={Icon.Pencil}
                  // Raycast suggests ⌘R for Refresh, but rename has been on ⌘R in
                  // this extension since day one and is used far more often here.
                  // The rescan action takes ⌘⇧R instead.
                  // eslint-disable-next-line @raycast/prefer-common-shortcut
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={() =>
                    push(
                      <FolderNameForm
                        submitTitle="Rename"
                        defaultValue={folder.name}
                        onSubmit={(name) => mutate((c) => renameFolder(c, folder.id, name))}
                      />,
                    )
                  }
                />
                <Action
                  title="Move Folder Left"
                  icon={Icon.ArrowLeft}
                  shortcut={{ modifiers: ["opt", "shift"], key: "arrowLeft" }}
                  onAction={() => mutate((c) => moveFolder(c, folder.id, -1))}
                />
                <Action
                  title="Move Folder Right"
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["opt", "shift"], key: "arrowRight" }}
                  onAction={() => mutate((c) => moveFolder(c, folder.id, 1))}
                />
                <Action
                  title="Delete Folder"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => mutate((c) => deleteFolder(c, folder.id))}
                />
                <Action
                  title="Create New Folder"
                  icon={Icon.NewFolder}
                  shortcut={Keyboard.Shortcut.Common.New}
                  onAction={() =>
                    push(
                      <FolderNameForm
                        submitTitle="Create"
                        onSubmit={(name) => mutate((c) => createFolder(c, newId(), name))}
                      />,
                    )
                  }
                />
              </ActionPanel.Section>
              <GlobalActions />
            </>
          )}
        </ActionPanel>
      }
    />
  );
}

/**
 * Three tiers, best first: the composite, the first app's own icon while the
 * composite is still building, and a plain folder for an empty folder.
 */
function folderContent(folder: Folder, iconPath: string | undefined): Image.ImageLike {
  if (iconPath) return { source: iconPath };
  if (folder.apps.length > 0) return { fileIcon: folder.apps[0].path };
  return Icon.Folder;
}
