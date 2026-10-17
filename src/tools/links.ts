import { App, TFile, getLinkpath, parseFrontMatterAliases, type CachedMetadata, type Pos } from "obsidian";
import type { ToolResult } from "../types";

/**
 * `get_links`: a note's links as Obsidian's Backlinks and Outgoing links
 * panes show them. Linked mentions (notes that link to it, with the
 * lines), unlinked mentions (its name or an alias in other notes' text,
 * not inside a link, any case) and outgoing links, links to notes that
 * don't exist yet included.
 */

/** Notes listed per section. */
const MAX_NOTES = 50;
/** Lines shown per note. */
const MAX_LINES = 3;
const MAX_LINE_CHARS = 200;

export async function getLinks(app: App, file: TFile): Promise<ToolResult> {
  const touched = new Set<string>([file.path]);
  const sections = [
    await linkedMentions(app, file, touched),
    await unlinkedMentions(app, file, touched),
    outgoingLinks(app, file, touched),
  ];
  return { result: `Links of ${file.path}\n\n${sections.join("\n\n")}`, isError: false, instructionPaths: [...touched] };
}

async function linkedMentions(app: App, file: TFile, touched: Set<string>): Promise<string> {
  const sources = Object.entries(app.metadataCache.resolvedLinks)
    .filter(([, targets]) => targets[file.path])
    .map(([source]) => source)
    .sort();
  if (sources.length === 0) return "Linked mentions: none.";
  const entries: string[] = [];
  for (const path of sources.slice(0, MAX_NOTES)) {
    const source = app.vault.getFileByPath(path);
    const count = app.metadataCache.resolvedLinks[path]?.[file.path] ?? 1;
    const cache = source ? app.metadataCache.getFileCache(source) : null;
    const lines = new Set<number>();
    for (const link of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
      if (app.metadataCache.getFirstLinkpathDest(getLinkpath(link.link), path)?.path === file.path) {
        lines.add(link.position.start.line);
      }
    }
    touched.add(path);
    const text = source && lines.size ? await app.vault.cachedRead(source) : "";
    entries.push(entry(path, `${count} link${count === 1 ? "" : "s"}`, text, [...lines]));
  }
  return `Linked mentions (${sources.length} note${sources.length === 1 ? "" : "s"}):\n${entries.join("\n")}${more(sources.length)}`;
}

async function unlinkedMentions(app: App, file: TFile, touched: Set<string>): Promise<string> {
  const names = mentionNames(app, file);
  if (names.length === 0) return "Unlinked mentions: none.";
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const found: { path: string; text: string; lines: number[] }[] = [];
  for (const note of app.vault.getMarkdownFiles()) {
    if (note.path === file.path) continue;
    touched.add(note.path);
    const text = await app.vault.cachedRead(note);
    if (!text) continue;
    const skipped = skippedRanges(app.metadataCache.getFileCache(note));
    const lines = new Set<number>();
    let line = 0;
    let newline = text.indexOf("\n");
    let range = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      while (newline !== -1 && newline < at) {
        line++;
        newline = text.indexOf("\n", newline + 1);
      }
      while (range < skipped.length && skipped[range][1] <= at) range++;
      if (range < skipped.length && skipped[range][0] < at + match[0].length) continue;
      lines.add(line);
    }
    if (lines.size) found.push({ path: note.path, text, lines: [...lines] });
  }
  if (found.length === 0) return `Unlinked mentions of ${names.map((n) => `"${n}"`).join(", ")}: none.`;
  found.sort((a, b) => a.path.localeCompare(b.path));
  const entries = found.slice(0, MAX_NOTES).map(({ path, text, lines }) =>
    entry(path, `${lines.length} line${lines.length === 1 ? "" : "s"}`, text, lines));
  return `Unlinked mentions (${found.length} note${found.length === 1 ? "" : "s"}; to link one, edit it to [[${file.basename}]]):\n${entries.join("\n")}${more(found.length)}`;
}

function outgoingLinks(app: App, file: TFile, touched: Set<string>): string {
  const resolved = Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {}).sort();
  for (const path of resolved.slice(0, MAX_NOTES)) touched.add(path);
  const unresolved = Object.keys(app.metadataCache.unresolvedLinks[file.path] ?? {}).sort();
  if (resolved.length === 0 && unresolved.length === 0) return "Outgoing links: none.";
  const lines = [
    ...resolved.map((path) => `- ${path}`),
    ...unresolved.map((name) => `- ${name} (no such note yet)`),
  ];
  return `Outgoing links (${lines.length}):\n${lines.slice(0, MAX_NOTES).join("\n")}${more(lines.length)}`;
}

/** The note's name and its aliases, the longest first so a longer name wins. */
function mentionNames(app: App, file: TFile): string[] {
  const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter) ?? [];
  const names = [file.basename, ...aliases].map((name) => name.trim()).filter((name) => name.length > 1);
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}

/** Offsets that aren't text: properties, links and embeds. */
function skippedRanges(cache: CachedMetadata | null): [number, number][] {
  const ranges: [number, number][] = [];
  const add = (position?: Pos) => {
    if (position) ranges.push([position.start.offset, position.end.offset]);
  };
  add(cache?.frontmatterPosition);
  for (const link of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) add(link.position);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function entry(path: string, detail: string, text: string, lines: number[]): string {
  const all = text.split("\n");
  const shown = lines.sort((a, b) => a - b).slice(0, MAX_LINES)
    .map((line) => (all[line] ?? "").trim())
    .filter(Boolean)
    .map((line) => `  > ${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line}`);
  return [`- ${path} (${detail})`, ...shown].join("\n");
}

function more(total: number): string {
  return total > MAX_NOTES ? `\n…and ${total - MAX_NOTES} more.` : "";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
