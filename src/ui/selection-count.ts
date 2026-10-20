const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ーｰ]/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;

/** CJK characters count separately; other letters and numbers form words. */
export function countSelection(text: string): { words: number; characters: number } {
  let words = 0;
  const remaining = text.replace(CJK_CHARACTER, () => {
    words++;
    return " ";
  });
  words += remaining.match(WORD)?.length ?? 0;
  // Obsidian's status bar uses string.length, including spaces and newlines.
  return { words, characters: text.length };
}

export function selectionCountLabel(text: string): string {
  const { words, characters } = countSelection(text);
  return `${words} ${words === 1 ? "word" : "words"} · ${characters} ${characters === 1 ? "character" : "characters"}`;
}
