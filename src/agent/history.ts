import type { ChatHistoryEntry, UnifiedMessage } from "../types";

function startsUserTurn(message: UnifiedMessage): boolean {
  return message.role === "user" && (typeof message.content === "string" ||
    message.content.some(block => block.type === "text" || block.type === "image"));
}

/** Keep whole user turns so pruning/persistence cannot orphan tool results. */
export function trimHistory(messages: UnifiedMessage[], limit: number): UnifiedMessage[] {
  const firstTurn = messages.findIndex(startsUserTurn);
  if (firstTurn < 0) return [];
  let start = firstTurn;
  const cutoff = Math.max(0, messages.length - limit);
  for (let index = firstTurn; index <= cutoff; index++) {
    if (startsUserTurn(messages[index])) start = index;
  }
  return start === 0 ? messages : messages.slice(start);
}

let turnCount = 0;

/** A new ID for a user turn. */
export function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${(turnCount++).toString(36)}`;
}

/**
 * The agent history up to just before the turn `turnId`, as a new array
 * (so the OpenAI adapter can't chain to a response from the cut-off part).
 * A turn that isn't there was trimmed away, since every turn goes into both
 * histories: all of the history comes after it, and nothing is kept.
 */
export function cutBeforeTurn(messages: UnifiedMessage[], turnId: string): UnifiedMessage[] {
  const index = messages.findIndex(message => message.turnId === turnId && startsUserTurn(message));
  return index < 0 ? messages : messages.slice(0, index);
}

/**
 * Turn `turnId` can be edited or answered again: the API history still
 * holds it. A turn cut off by the history's limit can't: cutting there
 * would leave the model without the whole chat.
 */
export function editableTurn(messages: UnifiedMessage[], turnId: string): boolean {
  return messages.some(message => message.turnId === turnId && startsUserTurn(message));
}

/** The text a user turn was sent with: context first, the user's text last. */
function sentText(message: UnifiedMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map(block => block.type === "text" ? block.text ?? "" : "").join("");
}

/**
 * Gives a chat saved before turn IDs existed matching IDs in both
 * histories, in place; a chat that has any turn ID is left as it is. Each
 * turn added one user entry to the view's history and one turn start to
 * the agent's, so they are paired from the end. A user entry whose text
 * doesn't end the turn start's text is an `ask_user` answer, no turn of its
 * own: it gets no ID. Entries older than the (trimmed) agent history get
 * IDs of their own. Only IDs are added; nothing else changes.
 */
export function assignLegacyTurnIds(entries: ChatHistoryEntry[], messages: UnifiedMessage[]): void {
  if (entries.some(entry => entry.turnId) || messages.some(message => message.turnId)) return;
  const starts = messages.filter(startsUserTurn);
  let start = starts.length - 1;
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "user") continue;
    if (start < 0) {
      entry.turnId = `legacy-${++count}`;
      continue;
    }
    const sent = sentText(starts[start]);
    const text = entry.text ?? "";
    if (sent !== text && !sent.endsWith(`\n\n${text}`)) continue;
    entry.turnId = starts[start].turnId = `legacy-${++count}`;
    start--;
  }
}
