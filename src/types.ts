// ─── Settings ───────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai" | "chatgpt-oauth";

export interface ChatSettings {
  provider: Provider;
  /** API key for `anthropic` and `openai`. Empty for `chatgpt-oauth` (which uses SecretStorage credentials). */
  apiKey: string;
  model: string;
  /**
   * Thinking level as the provider names it (e.g. `"high"`). Empty: the
   * model's default. The levels on offer come from the model catalog.
   */
  thinkingLevel: string;
  maxIterations: number;
  enableWebSearch: boolean;
  /** Enter sends (Shift+Enter: new line); off: Enter is a new line, Ctrl/Cmd+Enter sends. */
  enterSends: boolean;
  /** Show each edit the AI makes: its note or canvas opens at the changed spot (`ui/show-in-view.ts`). */
  followEdits: boolean;
  /** Write `debug.log` in the plugin folder (troubleshooting; logs messages, never keys). */
  debugLog: boolean;
  modelCatalog?: import("./api/model-catalog").CatalogState;
}

/**
 * Each provider's default model: for a new setup, after switching providers,
 * and when no model is saved (`loadSettings()` always sets one, so the
 * adapters need no default of their own).
 *
 * ChatGPT's is confirmed working in user reports. Other Codex model IDs may
 * be unavailable to a particular ChatGPT account even when listed in the
 * CLI catalog.
 */
export const DEFAULT_PROVIDER_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-6.1-sol",
  "chatgpt-oauth": "gpt-5.5",
};

export const DEFAULT_SETTINGS: ChatSettings = {
  provider: "anthropic",
  apiKey: "",
  model: DEFAULT_PROVIDER_MODELS.anthropic,
  thinkingLevel: "",
  maxIterations: 20,
  enableWebSearch: true,
  enterSends: true,
  followEdits: true,
  debugLog: false,
};

// ─── Unified Message Format ─────────────────────────────────────────────────

export interface ImageAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  /** Base64 image bytes without the data-URL prefix. */
  data: string;
  sizeBytes: number;
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  image?: ImageAttachment;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  /** tool_result only: images the tool returned (view_image, view_canvas). */
  images?: ImageAttachment[];
}

export interface UnifiedMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  /** Exact provider output for replay, separate from user-visible content. */
  replay?: ProviderReplay;
  /**
   * On the message that starts a user turn: the turn's ID, also on its
   * entry in the chat view's history, so both can be cut there.
   */
  turnId?: string;
}

export interface ProviderReplay {
  provider: Provider;
  model?: string;
  identity?: string;
  items: Record<string, unknown>[];
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export interface UnifiedToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── API Response ───────────────────────────────────────────────────────────

export interface UnifiedResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | "pause_turn";
  replay?: ProviderReplay;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Conversation Context ───────────────────────────────────────────────────

export interface ConversationContext {
  activeFile: string | null;
  selection: string | null;
  vaultName: string;
  fileCount: number;
}

// ─── Selection Scope ────────────────────────────────────────────────────────

export interface SelectionScope {
  /** The selected text */
  text: string;
  /** Path to the file containing the selection */
  filePath: string;
  /** Where the selection starts in the note (character offset), so a repeated text isn't mistaken for it. */
  from?: number;
  /** How many copies of the text come before the selection in the note (0: it is the first). */
  occurrence?: number;
  /** In-memory editor snapshot used to relocate safely; never sent to the model. */
  sourceText?: string;
}

// ─── Chat View History ──────────────────────────────────────────────────────

/** One entry of the visible chat history (`plugin.chatHistory`). */
export interface ChatHistoryEntry {
  type: "user" | "assistant" | "tool-result" | "error";
  text?: string;
  images?: ImageAttachment[];
  /** User entries of a turn (not `ask_user` answers): the turn's ID, shared with the agent history. */
  turnId?: string;
  /** User entries: the selection scope the turn ran with. */
  selection?: SelectionScope;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { result: string; isError: boolean };
  /** Error entries: "stopped" is the quiet note left by Stop before any answer was shown. */
  errorKind?: "stopped";
}

/** A row of the chat view's history list. */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Last use, in ms. */
  updatedAt: number;
  /** The conversation shown now. */
  active: boolean;
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface ToolResult {
  result: string;
  isError: boolean;
  /**
   * Images for the model. They are kept only in the agent history; the
   * chat view gets the text with a marker instead (`AgentLoop`).
   */
  images?: ImageAttachment[];
  /** What a tool changed, for showing it to the user; never sent to the model or saved. */
  focus?: ViewTarget;
}

/** A spot to show in a note (character range) or canvas (card IDs). */
export interface ViewTarget {
  path: string;
  /** Range in the note's text after the change. */
  from?: number;
  to?: number;
  /** Canvas cards. */
  nodes?: string[];
}

// ─── Agent Loop Callbacks ───────────────────────────────────────────────────

export interface AgentCallbacks {
  onThinking: () => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onResponse: (text: string) => void;
  onAskUser: (question: string) => Promise<string>;
  onError: (error: string) => void;
}
