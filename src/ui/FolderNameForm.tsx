import { Action, ActionPanel, Form, useNavigation } from "@raycast/api";

/**
 * Create and rename were two identical forms differing only in their button
 * label and default value.
 */
export function FolderNameForm({
  submitTitle,
  defaultValue,
  onSubmit,
}: {
  submitTitle: string;
  defaultValue?: string;
  onSubmit: (name: string) => void;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={submitTitle}
            onSubmit={(values: { name: string }) => {
              const name = values.name.trim();
              if (name) onSubmit(name);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Folder Name" placeholder="e.g. Code" defaultValue={defaultValue} autoFocus />
    </Form>
  );
}
