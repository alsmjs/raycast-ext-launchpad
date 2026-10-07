/**
 * Parsing for `mdls -name kMDItemDisplayName <path>…` — the names macOS actually
 * displays ("计算器" rather than "Calculator").
 *
 * The output is positional: one line per path, in the order given, with no path
 * in the line itself. Two properties of that format matter:
 *
 *   - A path Spotlight has no name for still produces a line (`(null)`), so the
 *     alignment holds.
 *   - A path that doesn't exist does NOT get a normal line. `mdls` prints an
 *     error *to stdout* at that position and then stops, leaving every later
 *     path unanswered (and exits 1). Verified on macOS 26:
 *
 *         kMDItemDisplayName = "计算器.app"
 *         /System/Applications/Calculator.app: could not find /Applications/Gone.app.
 *         <nothing for the remaining paths>
 *
 * Callers should therefore not pass paths they haven't confirmed exist. This
 * parser's job is to degrade gracefully when one slips through anyway: names
 * before the failure are kept, the rest are simply absent, and nothing is ever
 * assigned to the wrong app.
 */
export function parseDisplayNames(raw: string, paths: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const lines = raw.split("\n");

  for (let i = 0; i < paths.length && i < lines.length; i++) {
    const line = lines[i];
    // Anything that isn't a well-formed answer means the positional mapping can
    // no longer be trusted from here on.
    if (!line.startsWith("kMDItemDisplayName = ")) break;
    const match = line.match(/^kMDItemDisplayName = "(.+?)(?:\.app)?"\s*$/);
    if (match) names.set(paths[i], match[1]);
  }

  return names;
}
