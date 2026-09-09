import { Action, ActionPanel, Icon } from "@raycast/api";
import { Folder } from "../core/types";

/**
 * Raycast has no drag-and-drop in grids, so "move into a folder" is a submenu of
 * folder names. Renders nothing when there is nowhere to move to, which keeps
 * the action panel honest instead of offering an empty submenu.
 */
export function MoveToFolderAction({
  title,
  folders,
  excludeFolderId,
  onMove,
}: {
  title: string;
  folders: Folder[];
  excludeFolderId?: string;
  onMove: (folderId: string) => void;
}) {
  const targets = folders.filter((f) => f.id !== excludeFolderId);
  if (targets.length === 0) return null;

  return (
    <ActionPanel.Submenu title={title} icon={Icon.Folder}>
      {targets.map((folder) => (
        <Action key={folder.id} title={folder.name} onAction={() => onMove(folder.id)} />
      ))}
    </ActionPanel.Submenu>
  );
}
