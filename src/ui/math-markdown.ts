// Rewrites the math delimiters models often use into the ones Obsidian
// renders ($...$ and $$...$$), and escapes the pipe of a [[link|alias]] in a
// table row (Obsidian needs [[link\|alias]] there; models rarely write it).
// Applied at render time only; stored messages stay unchanged. Adapted from
// src/ui/math-markdown.ts in nagisa525/obsidian-chatting-plus (MIT).

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const MATH_INFO = /^\s*(?:math|latex|tex)\s*$/i;
// Inline code spans: a backtick run closed by a run of the same length.
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
// Keep raw HTML code and comments literal too. Match spans first so a tag
// shown inside backticks cannot start an HTML region that swallows prose.
const HTML_CODE = /<!--[\s\S]*?(?:-->|$)|<(?<htmlTag>code|pre)(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\k<htmlTag>\s*>|$)/i;
const LITERAL_CODE = new RegExp(`${CODE_SPAN.source}|${HTML_CODE.source}`, "gi");
// An escaped backslash is matched first, so `\\[` or `\\(` (e.g. a LaTeX
// line break like `\\[2pt]`) is never taken for an opening delimiter.
const DISPLAY = /\\\\|\\\[([\s\S]*?)\\\]/g;
const INLINE = /\\\\|\\\(([^\n]*?)\\\)/g;
// A table row, and the unescaped alias pipe of a wiki link in it.
const LINK_ALIAS = /(\[\[[^\]|\n]*[^\]|\\\n])\|([^\]\n]*\]\])/g;

export function normalizeMathMarkdown(source: string): string {
  // Line endings are unified, so a CRLF fence is still recognized.
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let offset = 0;
  const starts = lines.map(line => { const start = offset; offset += line.length + 1; return start; });
  const htmlRegions = [...normalized.matchAll(LITERAL_CODE)].filter(span => span[0].startsWith("<"))
    .map(span => ({ start: span.index, end: span.index + span[0].length }));
  const out: string[] = [];
  let prose: string[] = [];
  const containerLists = new Map<number, number[]>();
  const flushProse = () => {
    if (prose.length > 0) out.push(normalizeProse(prose.join("\n")));
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    // A Markdown-looking fence in a raw HTML code body is literal content.
    if (htmlRegions.some(region => starts[i] >= region.start && starts[i] < region.end)) {
      prose.push(lines[i]);
      continue;
    }
    const container = quoteContainer(lines[i]);
    const line = container.content;
    for (const depth of containerLists.keys()) {
      if (depth > container.depth) containerLists.delete(depth);
    }
    const listIndents = containerLists.get(container.depth) ?? [];
    containerLists.set(container.depth, listIndents);
    const indentation = indentWidth(line);
    if (line.trim()) {
      while (listIndents.length && indentation < listIndents[listIndents.length - 1]) listIndents.pop();
    }
    const codeIndent = (listIndents.at(-1) ?? 0) + 4;
    // Indented code cannot interrupt a paragraph. A list item's own content
    // indentation is not code; it needs another four columns.
    if (line.trim() && indentation >= codeIndent && (i === 0 || !quoteContainer(lines[i - 1]).content.trim())) {
      flushProse();
      let end = i + 1;
      while (end < lines.length) {
        const next = quoteContainer(lines[end], container.depth);
        if (next.depth !== container.depth || (next.content.trim() && indentWidth(next.content) < codeIndent)) break;
        end++;
      }
      out.push(...lines.slice(i, end));
      i = end - 1;
      continue;
    }
    const list = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(line);
    if (list) listIndents.push(indentWidth(list[0].replace(/[^ \t]/g, " ")));
    const fenceBase = listIndents.at(-1) ?? 0;
    const open = FENCE_OPEN.exec(list ? line.slice(list[0].length) : line);
    // A backtick fence's info string can't contain backticks (CommonMark).
    if (!open || (list ? fenceBase + indentWidth(open[1]) : indentation) > fenceBase + 3 || (open[2][0] === "`" && open[3].includes("`"))) {
      prose.push(lines[i]);
      continue;
    }
    const [, indent, fence, info] = open;
    let end = i + 1;
    let closed = false;
    while (end < lines.length) {
      const next = quoteContainer(lines[end], container.depth);
      // Fenced code ends with its container even without a closing fence.
      if (next.depth !== container.depth || (next.content.trim() && indentWidth(next.content) < fenceBase)) break;
      if (closesFence(next.content, fence, fenceBase)) { closed = true; break; }
      end++;
    }
    const body = lines.slice(i + 1, end);
    flushProse();

    if (closed && MATH_INFO.test(info) && body.some(line => quoteContainer(line).content.trim())) {
      while (!quoteContainer(body[0]).content.trim()) body.shift();
      while (!quoteContainer(body[body.length - 1]).content.trim()) body.pop();
      const opening = container.prefix + (list?.[0] ?? "") + indent;
      const closing = container.prefix + (list ? " ".repeat(fenceBase) : "") + indent;
      out.push(`${opening}$$`, ...body, `${closing}$$`);
    } else {
      // Ordinary code (or an unclosed fence, which runs to the end) is kept as is.
      out.push(...lines.slice(i, end + (closed ? 1 : 0)));
    }
    i = closed ? end : end - 1;
  }
  flushProse();
  return out.join("\n");
}

function quoteContainer(line: string, limit = Infinity): { prefix: string; content: string; depth: number } {
  let prefix = "", depth = 0, content = line;
  while (depth < limit) {
    const marker = /^ {0,3}>[ \t]?/.exec(content);
    if (!marker) break;
    prefix += marker[0];
    content = content.slice(marker[0].length);
    depth++;
  }
  return { prefix, content, depth };
}

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width++;
    else if (char === "\t") width += 4 - width % 4;
    else break;
  }
  return width;
}

function closesFence(line: string, fence: string, base: number): boolean {
  const close = /^([ \t]*)(`{3,}|~{3,})\s*$/.exec(line);
  return close !== null && indentWidth(close[1]) >= base && indentWidth(close[1]) <= base + 3
    && close[2][0] === fence[0] && close[2].length >= fence.length;
}

function normalizeProse(text: string): string {
  const tableRows = tableRowStarts(text);
  let result = "";
  let cursor = 0;
  for (const span of text.matchAll(LITERAL_CODE)) {
    const index = span.index ?? 0;
    result += normalizeDelimiters(text.slice(cursor, index), cursor, tableRows, text) + span[0];
    cursor = index + span[0].length;
  }
  return result + normalizeDelimiters(text.slice(cursor), cursor, tableRows, text);
}

function tableRowStarts(text: string): Set<number> {
  const lines = text.split("\n");
  const contents = lines.map(tableContainer);
  const starts: number[] = [];
  const rows = new Set<number>();
  let offset = 0;
  let inTable = false;
  let tableDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    starts.push(offset);
    const { content: line, depth } = contents[i];
    if (!line.trim() || tableDepth !== depth) inTable = false;
    tableDepth = depth;
    // Recognize a real delimiter row for tables without outer pipes. Ignore
    // pipes inside wiki links, escaped text and inline code when counting cells.
    const cells = (value: string) => value.replace(CODE_SPAN, "").replace(/\[\[[^\n]*?\]\]/g, "")
      .replace(/\\\|/g, "").trim().replace(/^\||\|$/g, "").split("|");
    const columns = cells(line);
    if (i > 0 && line.includes("|") && columns.every(cell => /^\s*:?-+:?\s*$/.test(cell))
      && contents[i - 1].depth === depth && contents[i - 1].content.trim()
      && cells(contents[i - 1].content).length === columns.length) {
      inTable = true;
      rows.add(starts[i - 1]);
    }
    if (inTable || /^[ \t]*\|/.test(line)) rows.add(offset);
    offset += lines[i].length + 1;
  }
  return rows;
}

function tableContainer(line: string): { content: string; depth: number } {
  let content = line, depth = 0;
  while (true) {
    const quote = quoteContainer(content);
    content = quote.content;
    depth += quote.depth;
    const list = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(content);
    if (!list) return { content, depth };
    content = content.slice(list[0].length);
  }
}

function normalizeDelimiters(text: string, offset: number, tableRows: Set<number>, source: string): string {
  return text
    .replace(LINK_ALIAS, (match, before: string, after: string, index: number) =>
      tableRows.has(source.lastIndexOf("\n", offset + index) + 1) ? `${before}\\|${after}` : match)
    // Display math keeps its own spacing and line breaks, so a block written
    // on its own lines stays a block (also inside list items).
    .replace(DISPLAY, (match, expression: string | undefined) =>
      expression?.trim() ? `$$${expression}$$` : match)
    // Obsidian needs inline math to touch its dollar signs: `$x$`, not `$ x $`.
    .replace(INLINE, (match, expression: string | undefined) =>
      expression?.trim() ? `$${expression.trim()}$` : match);
}
