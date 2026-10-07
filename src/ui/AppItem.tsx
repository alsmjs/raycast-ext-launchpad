import { Action, ActionPanel, Grid, Icon, Keyboard, showHUD, showToast, Toast, useNavigation } from "@raycast/api";
import { newId } from "../core/id";
import { createFolder, hideApps, moveApps, reorderApp, toggleSystemProxyInjection } from "../core/mutations";
import { proxyEnv } from "../core/proxy";
import { AppEntry, isOverrideActive, LaunchpadConfig, Scope } from "../core/types";
import { launchApp, quitAndRelaunch, readSystemProxy } from "../services/launcher";
import { mutate } from "../store";
import { FolderNameForm } from "./FolderNameForm";
import { GlobalActions } from "./GlobalActions";
import { Mode, pluralizeAppsTitleCase } from "./mode";
import { MoveToFolderAction } from "./MoveToFolderAction";
import { Selection } from "./useSelection";

/**
 * One app cell, shared by the top-level grid and the folder grid. `scope` is the
 * only thing that differs between the two, which is what lets a single set of
 * actions serve both.
 */
export function AppItem({
  app,
  scope,
  mode,
  config,
  selection,
  iconPath,
  onDone,
}: {
  app: AppEntry;
  /** Cached high-res PNG, when one has been extracted. */
  iconPath: string | undefined;
  scope: Scope;
  mode: Mode;
  config: LaunchpadConfig;
  selection: Selection;
  /** Leave Multi-Move: back to Apps mode at the top level, pop out of a folder. */
  onDone: () => void;
}) {
  const { push } = useNavigation();

  const override = config.launchOverrides[app.bundleId];
  // Two different questions. `injects` drives the 🌐 marker: will this launch
  // carry *any* injected environment? `proxyOn` drives the toggle, which only
  // ever controls the proxy half — keying it on `injects` would flip the label
  // for an app that has custom env but no proxy, and pressing it would then do
  // the opposite of what it says.
  const injects = isOverrideActive(override);
  const proxyOn = override?.injectSystemProxy === true;
  const inFolder = scope.kind === "folder";
  const isSelected = selection.has(app.bundleId);

  return (
    <Grid.Item
      id={app.bundleId}
      // The globe marks an app that launches with an injected environment.
      // A title prefix rather than an `accessory`: no extra render node, no
      // change to the cell's height, and Raycast still substring-matches the
      // name in the search bar.
      title={injects ? `🌐 ${app.name}` : app.name}
      // `Application.name` is the English bundle name; `app.name` is what macOS
      // displays. Without this, a localized app ("密码") is unreachable by typing
      // the name printed in its own docs ("Passwords").
      keywords={app.systemName ? [app.systemName] : undefined}
      // Our own extraction rather than `fileIcon`, which Raycast 2 renders too
      // small for a grid cell. `fileIcon` remains the fallback until the PNG
      // exists, or for an app with no .icns to extract.
      content={iconPath ? { source: iconPath } : { fileIcon: app.path }}
      accessory={mode === "multi" && isSelected ? { icon: Icon.CheckCircle, tooltip: "Selected" } : undefined}
      actions={
        <ActionPanel>
          {mode === "multi" ? (
            <MultiMoveActions app={app} scope={scope} config={config} selection={selection} onDone={onDone} />
          ) : (
            <>
              <Action title="Open" icon={Icon.ArrowRight} onAction={() => launch(app, config)} />

              {/* Position #2 keeps ⌘↵ (Raycast assigns it automatically) on the
                  harmless submenu it has always been on. */}
              <MoveToFolderAction
                title="Move to Folder"
                folders={config.folders}
                excludeFolderId={inFolder ? scope.folderId : undefined}
                onMove={(folderId) => mutate((c) => moveApps(c, [app.bundleId], { kind: "folder", folderId }))}
              />

              <ActionPanel.Section title="Launch">
                <Action
                  title={proxyOn ? "Disable System Proxy Injection" : "Enable System Proxy Injection"}
                  icon={Icon.Globe}
                  // ⌘P is reserved by Raycast for the search-bar dropdown.
                  shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                  onAction={() => toggleProxyInjection(app, proxyOn)}
                />
              </ActionPanel.Section>

              <ActionPanel.Section title="Organize">
                {inFolder && (
                  <Action
                    title="Move to Top Level"
                    icon={Icon.ArrowUp}
                    onAction={() => mutate((c) => moveApps(c, [app.bundleId], { kind: "uncategorized" }))}
                  />
                )}
                <Action
                  title="Move App Left"
                  icon={Icon.ArrowLeft}
                  shortcut={{ modifiers: ["opt", "shift"], key: "arrowLeft" }}
                  onAction={() => mutate((c) => reorderApp(c, scope, app.bundleId, -1))}
                />
                <Action
                  title="Move App Right"
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["opt", "shift"], key: "arrowRight" }}
                  onAction={() => mutate((c) => reorderApp(c, scope, app.bundleId, 1))}
                />
                <Action
                  title="Hide App"
                  icon={Icon.EyeDisabled}
                  style={Action.Style.Destructive}
                  onAction={() => mutate((c) => hideApps(c, [app.bundleId]))}
                />
                {!inFolder && (
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
                )}
              </ActionPanel.Section>

              <GlobalActions />
            </>
          )}
        </ActionPanel>
      }
    />
  );
}

function MultiMoveActions({
  app,
  scope,
  config,
  selection,
  onDone,
}: {
  app: AppEntry;
  scope: Scope;
  config: LaunchpadConfig;
  selection: Selection;
  onDone: () => void;
}) {
  const { push } = useNavigation();

  const inFolder = scope.kind === "folder";
  const bucket =
    scope.kind === "folder" ? (config.folders.find((f) => f.id === scope.folderId)?.apps ?? []) : config.uncategorized;
  const count = selection.count;
  const label = pluralizeAppsTitleCase(count);

  /** Snapshot the ids before mutating — the bucket is about to change under us. */
  const withSelected = (run: (bundleIds: string[]) => void) => () => {
    const ids = selection.ordered(bucket);
    if (ids.length === 0) return;
    run(ids);
    selection.clear();
  };

  return (
    <>
      <Action
        title={selection.has(app.bundleId) ? "Deselect" : "Select"}
        icon={Icon.CheckList}
        onAction={() => selection.toggle(app.bundleId)}
      />
      {/* Position #2 — Raycast assigns ⌘↵ here. */}
      <Action title="Done" icon={Icon.Checkmark} onAction={onDone} />
      <Action
        title="Select All"
        icon={Icon.CheckList}
        onAction={() => selection.selectAll(bucket.map((a) => a.bundleId))}
      />
      <Action title="Deselect All" icon={Icon.XMarkCircle} onAction={selection.clear} />

      {count > 0 && (
        <ActionPanel.Section title={`${count} selected`}>
          {inFolder && (
            <Action
              title={`Move ${label} to Top Level`}
              icon={Icon.ArrowUp}
              onAction={withSelected((ids) => mutate((c) => moveApps(c, ids, { kind: "uncategorized" })))}
            />
          )}
          <MoveToFolderAction
            title={`Move ${label} to Folder`}
            folders={config.folders}
            excludeFolderId={inFolder ? scope.folderId : undefined}
            onMove={(folderId) =>
              withSelected((ids) => mutate((c) => moveApps(c, ids, { kind: "folder", folderId })))()
            }
          />
          <Action
            title={`Move ${label} to New Folder…`}
            icon={Icon.NewFolder}
            shortcut={Keyboard.Shortcut.Common.New}
            onAction={() =>
              push(
                <FolderNameForm
                  submitTitle="Create"
                  onSubmit={(name) =>
                    withSelected((ids) =>
                      mutate((c) => moveApps(c, ids, { kind: "newFolder", folderId: newId(), name })),
                    )()
                  }
                />,
              )
            }
          />
        </ActionPanel.Section>
      )}

      <GlobalActions />
    </>
  );
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function launch(app: AppEntry, config: LaunchpadConfig): Promise<void> {
  const override = config.launchOverrides[app.bundleId];
  const outcome = await launchApp(app, override);
  const injectedWhat = override?.injectSystemProxy ? "system proxy" : "custom environment";

  if (outcome !== "already-running") {
    await showHUD(outcome === "injected" ? `Opened ${app.name} with ${injectedWhat}` : `Opened ${app.name}`);
    return;
  }

  // `open --env` silently does nothing for a running app (and still exits 0), so
  // say so rather than letting the user believe the proxy took effect. A Toast
  // rather than a HUD because it keeps the window open for the follow-up action.
  await showToast({
    style: Toast.Style.Failure,
    title: `${app.name} is already running`,
    message: "Environment variables only apply at launch",
    primaryAction: {
      title: "Quit & Relaunch",
      onAction: async (toast) => {
        toast.style = Toast.Style.Animated;
        toast.title = `Relaunching ${app.name}…`;
        toast.message = undefined;

        const result = await quitAndRelaunch(app, override);
        if (result === "quit-failed") {
          toast.style = Toast.Style.Failure;
          toast.title = `${app.name} didn't quit`;
          toast.message = "Quit it manually, then open it again";
        } else {
          toast.hide();
          await showHUD(`Opened ${app.name} with ${injectedWhat}`);
        }
      },
    },
  });
}

/**
 * Enabling always succeeds, even with no usable proxy configured — the user may
 * well be about to start theirs. What must not happen is enabling it *silently*
 * in that state, so the warning is loud and names what was actually found.
 */
async function toggleProxyInjection(app: AppEntry, currentlyOn: boolean): Promise<void> {
  mutate((c) => toggleSystemProxyInjection(c, app.bundleId));

  if (currentlyOn) {
    await showToast({ style: Toast.Style.Success, title: "System proxy injection disabled" });
    return;
  }

  const proxy = readSystemProxy();
  if (proxy.pacOnly) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Enabled, but nothing to inject",
      message: "The system uses a PAC script, which can't be reduced to a host:port",
    });
    return;
  }

  const env = proxyEnv(proxy);
  if (!env.HTTPS_PROXY) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Enabled, but nothing to inject",
      message: "No system HTTP or HTTPS proxy is configured",
    });
    return;
  }

  await showToast({
    style: Toast.Style.Success,
    title: "System proxy injection enabled",
    message: `HTTPS_PROXY=${env.HTTPS_PROXY}`,
  });
}
