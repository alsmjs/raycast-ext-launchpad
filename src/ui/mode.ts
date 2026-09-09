/** Which action set the grids expose. Toggled from the search bar dropdown. */
export type Mode = "app" | "multi";

export function pluralizeApps(count: number): string {
  return count === 1 ? "1 app" : `${count} apps`;
}

export function pluralizeAppsTitleCase(count: number): string {
  return count === 1 ? "1 App" : `${count} Apps`;
}
