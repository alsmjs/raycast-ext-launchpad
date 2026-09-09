import { Action, ActionPanel, Icon } from "@raycast/api";
import { rescanApplications } from "../store";

/**
 * Actions that belong to the extension rather than to whatever cell is
 * selected. Repeated at the bottom of every action panel, which is the Raycast
 * convention for reaching a global command from anywhere.
 */
export function GlobalActions() {
  return (
    <ActionPanel.Section>
      <Action
        title="Rescan Applications"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
        onAction={rescanApplications}
      />
    </ActionPanel.Section>
  );
}
