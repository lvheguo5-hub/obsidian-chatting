import { unpackBudget, zipEntries, zipText } from "./zip";

/**
 * The text of Word, Excel and PowerPoint files (docx, xlsx, pptx), for
 * providers that can't read them themselves (Anthropic). Reads
 * their XML with patterns, not a parser: these files are machine-written
 * and the patterns work the same on every platform (Node in the tests
 * has no DOMParser). Images, charts and formatting beyond headings,
 * lists and tables are left out.
 */

/** Rows read per sheet. */
const SHEET_ROWS = 2000;
/** Excel's column limit, plus bounds on CSV expansion across the workbook.
 * ZIP byte limits alone don't bound sparse rows or repeated shared strings.
 */
const SHEET_COLUMNS = 16384;
const WORKBOOK_CELLS = 100000;
const WORKBOOK_TEXT_CHARS = 1000000;
export const OFFICE_TEXT_CHARS = 100000;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_XML_MATCHES = 20000;

class TextBudget {
  private parts: string[] = [];
  left = OFFICE_TEXT_CHARS;
  stopped = false;
  add(text: string): void {
    const part = text.slice(0, this.left);
    // Release the backing XML rather than retaining a substring of it.
    this.parts.push(new TextDecoder().decode(new TextEncoder().encode(part)));
    this.left -= part.length;
    if (text.length > part.length || this.left === 0) this.stopped = true;
  }
  result(): string {
    const text = this.parts.join("");
    const note = "\n(Office text extraction limit reached)";
    return this.stopped ? text.slice(0, OFFICE_TEXT_CHARS - note.length) + note : text;
  }
}

export type OfficeKind = "docx" | "xlsx" | "pptx";

export function officeKind(fileName: string): OfficeKind | null {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return extension === "docx" || extension === "xlsx" || extension === "pptx" ? extension : null;
}

/** The file's text as Markdown. Throws for a damaged file. */
export async function officeText(bytes: Uint8Array, kind: OfficeKind): Promise<string> {
  const entries = zipEntries(bytes);
  // One budget for the whole file: a crafted file can't unpack without end.
  const budget = unpackBudget();
  const read = async (name: string) => {
    const initial = Math.min(budget.left, MAX_XML_BYTES);
    const entryBudget = { left: initial };
    try { return await zipText(bytes, entries, name, entryBudget); }
    finally { budget.left -= initial - entryBudget.left; }
  };
  if (kind === "docx") {
    const xml = await read("word/document.xml");
    if (xml === null) throw new Error("no word/document.xml");
    return docxText(xml);
  }
  if (kind === "pptx") {
    const slides: { name: string; number: number }[] = [];
    for (const name of entries.keys()) {
      const number = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1];
      if (!number) continue;
      if (slides.length >= MAX_XML_MATCHES) throw new Error("Too many PowerPoint slides");
      slides.push({ name, number: Number(number) });
    }
    slides.sort((a, b) => a.number - b.number);
    const text = new TextBudget();
    for (const { name, number } of slides) {
      if (text.stopped) break;
      text.add(`${text.left < OFFICE_TEXT_CHARS ? "\n\n" : ""}## Slide ${number}`);
      if (text.stopped) break;
      const xml = await read(name) ?? "";
      let count = 0;
      for (const match of xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
        if (++count > MAX_XML_MATCHES) throw new Error("Too many Office XML paragraphs");
        const line = runText(match[0], "a", text.left + 1).trim();
        if (line) text.add(`\n${line}`);
        if (text.stopped) break;
      }
    }
    return text.result();
  }
  return await xlsxText(read);
}

// ─── XML helpers ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });
}

function all(xml: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    if (parts.length >= MAX_XML_MATCHES) throw new Error("Too many Office XML elements");
    parts.push(match[0]);
  }
  return parts;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]) : undefined;
}

/** A run of text in namespace `ns` (w: Word, a: PowerPoint): its texts, tabs and breaks. */
function runText(xml: string, ns: string, limit = OFFICE_TEXT_CHARS + 1): string {
  const pattern = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>|<${ns}:tab\\s*/>|<${ns}:br\\s*/>`, "g");
  let text = "";
  for (const match of xml.matchAll(pattern)) {
    const part = match[1] !== undefined ? decode(match[1]) : match[0].includes(":tab") ? "\t" : "\n";
    text += part.slice(0, Math.max(0, limit - text.length));
    if (text.length >= limit) break;
  }
  return text;
}

/** The non-empty paragraphs of `xml` in namespace `ns`. */
function paragraphs(xml: string, ns: string): string[] {
  return all(xml, new RegExp(`<${ns}:p\\b[\\s\\S]*?</${ns}:p>`, "g"))
    .map((p) => runText(p, ns).trim())
    .filter(Boolean);
}

// ─── Word ───────────────────────────────────────────────────────────────────

function docxParagraph(p: string): string {
  const text = runText(p, "w").trim();
  if (!text) return "";
  // Heading style IDs: "Heading2", in German templates "berschrift2" (the Ü is dropped).
  const style = /<w:pStyle w:val="([^"]*)"/.exec(p)?.[1] ?? "";
  const level = /^(?:heading|berschrift|titre|kop)\s*(\d)$/i.exec(style)?.[1];
  const heading = level ? Number(level) : style === "Title" ? 1 : 0;
  if (heading) return `${"#".repeat(Math.min(heading, 6))} ${text}`;
  if (p.includes("<w:numPr>")) return `- ${text}`;
  return text;
}

function docxTable(table: string): string {
  let cellCount = 0;
  const rows = all(table, /<w:tr\b[\s\S]*?<\/w:tr>/g).map((row) => {
    const cells = all(row, /<w:tc\b[\s\S]*?<\/w:tc>/g);
    cellCount += cells.length;
    if (cellCount > WORKBOOK_CELLS) throw new Error("Too many Word table cells");
    return cells.map((cell) => paragraphs(cell, "w").join(" ").replace(/\|/g, "\\|"));
  });
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  if (rows.length * width > WORKBOOK_CELLS) throw new Error("Word table expansion is too large");
  const line = (cells: string[]) => `| ${[...cells, ...Array<string>(width - cells.length).fill("")].join(" | ")} |`;
  return [line(rows[0]), line(Array<string>(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function docxText(xml: string): string {
  const blocks = all(xml, /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g);
  const text = new TextBudget();
  for (const block of blocks) {
    const part = block.startsWith("<w:tbl") ? docxTable(block) : docxParagraph(block);
    if (part) text.add(`${text.left < OFFICE_TEXT_CHARS ? "\n\n" : ""}${part}`);
    if (text.stopped) break;
  }
  return text.result();
}

// ─── Excel ──────────────────────────────────────────────────────────────────

/** Column letters to a 0-based index ("A" 0, "AA" 26). */
function columnIndex(reference: string): number {
  if (!reference) return 0;
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference);
  if (!match || Number(match[2]) > 1048576) throw new Error("Invalid spreadsheet cell reference");
  const index = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  if (index >= SHEET_COLUMNS) throw new Error("Spreadsheet column exceeds XFD");
  return index;
}

function csvValue(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

async function xlsxText(read: (name: string) => Promise<string | null>): Promise<string> {
  const shared = all(await read("xl/sharedStrings.xml") ?? "", /<si>[\s\S]*?<\/si>/g)
    .map((si) => all(si, /<t(?:\s[^>]*)?>[^<]*<\/t>/g).map(tag => decode(tag.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, ""))).join(""));
  const workbook = await read("xl/workbook.xml") ?? "";
  const rels = await read("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map(all(rels, /<Relationship\b[^>]*>/g).map((tag) => [attribute(tag, "Id") ?? "", attribute(tag, "Target") ?? ""]));

  const parts: string[] = [];
  let expandedCells = 0;
  let textChars = 0;
  for (const tag of all(workbook, /<sheet\b[^>]*>/g)) {
    const name = attribute(tag, "name") ?? "Sheet";
    const target = targets.get(attribute(tag, "r:id") ?? "") ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheet = await read(path);
    if (sheet === null) continue;
    const rows = all(sheet, /<row\b[\s\S]*?<\/row>/g);
    const lines = rows.slice(0, SHEET_ROWS).map((row) => {
      const cells: string[] = [];
      for (const cell of all(row, /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const open = /<c\b[^>]*>/.exec(cell)?.[0] ?? "";
        // Check before assigning into the sparse array or expanding its gaps.
        const column = columnIndex(attribute(open, "r") ?? "");
        const type = attribute(open, "t");
        const raw = /<v>([^<]*)<\/v>/.exec(cell)?.[1];
        const value = type === "s" ? shared[Number(raw)] ?? ""
          : type === "inlineStr" ? all(cell, /<t(?:\s[^>]*)?>[^<]*<\/t>/g).map(tag => decode(tag.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, ""))).join("")
          : type === "b" ? (raw === "1" ? "TRUE" : "FALSE")
          : decode(raw ?? "");
        if (textChars + value.length > WORKBOOK_TEXT_CHARS) throw new Error("Spreadsheet text expansion is too large");
        const encoded = csvValue(value);
        textChars += encoded.length;
        if (textChars > WORKBOOK_TEXT_CHARS) throw new Error("Spreadsheet text expansion is too large");
        cells[column] = encoded;
      }
      expandedCells += cells.length;
      textChars += cells.length; // Separators and the row's newline.
      if (expandedCells > WORKBOOK_CELLS || textChars > WORKBOOK_TEXT_CHARS) {
        throw new Error("Spreadsheet row expansion is too large");
      }
      return Array.from(cells, (value) => value ?? "").join(",");
    }).filter((line) => line.replace(/,/g, "") !== "");
    const more = rows.length > SHEET_ROWS ? `\n(${rows.length - SHEET_ROWS} more rows not read)` : "";
    parts.push(`## Sheet: ${name}\n${lines.join("\n")}${more}`);
  }
  return parts.join("\n\n");
}
