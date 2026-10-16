import { sha256 } from "@noble/hashes/sha2.js";
import type { SelectionScope } from "./types";

/** A compact identity for a normalized editor snapshot, never sent to a model. */
export function selectionHash(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text.replace(/\r\n/g, "\n"))), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Full snapshots belong only to the active turn's selection enforcement. */
export function historySelection(selection: SelectionScope): SelectionScope {
  if (selection.sourceText === undefined) return selection;
  const { sourceText, ...rest } = selection;
  return { ...rest, sourceHash: selectionHash(sourceText) };
}
