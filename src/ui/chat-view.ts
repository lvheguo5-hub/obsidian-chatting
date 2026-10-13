import { ItemView, WorkspaceLeaf, Notice, Platform, Scope, type App } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import type ChatPlugin from "../main";
import ChatContainer from "./ChatContainer.svelte";
import type { ToolResult, SelectionScope, ImageAttachment, ConversationSummary, ViewTarget } from "../types";
import { showInView } from "./show-in-view";
import { screenAwake } from "../platform/screen-awake";
import { newTurnId } from "../agent/history";
import { mentionContext, mentionedFiles } from "./mentions";

export const VIEW_TYPE_CHAT = "ochatting-view";

const SAVED_INPUT_TEXT = 300;
const SAVED_INPUT_ITEMS = 10;
const SAVED_INPUT_KEYS = 20;

/**
 * A tool call's input as saved with its card, for display only: strings
 * cut to 300 characters, lists to 10 items and objects to 20 keys, so long
 * note content or canvas lists don't bloat `chat-state.json`.
 */
function savedToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const cap = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (value.length <= SAVED_INPUT_TEXT) return value;
      // Don't keep the first half of a surrogate pair (e.g. an emoji).
      const end = /[\uD800-\uDBFF]/.test(value[SAVED_INPUT_TEXT - 1]) ? SAVED_INPUT_TEXT - 1 : SAVED_INPUT_TEXT;
      return `${value.slice(0, end)}... (${value.length} characters)`;
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, SAVED_INPUT_ITEMS).map(cap);
      return value.length > SAVED_INPUT_ITEMS ? [...items, `... (${value.length - SAVED_INPUT_ITEMS} more)`] : items;
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      const kept = Object.fromEntries(entries.slice(0, SAVED_INPUT_KEYS).map(([key, item]) => [key, cap(item)]));
      if (entries.length > SAVED_INPUT_KEYS) kept["..."] = `(${entries.length - SAVED_INPUT_KEYS} more)`;
      return kept;
    }
    return value;
  };
  return cap(input) as Record<string, unknown>;
}

interface ChatContainerProps {
  app: App;
  component: ObsidianChatView;
  provider: string;
  model: string;
  onSend: (text: string, selection: SelectionScope | null, images: ImageAttachment[]) => void;
  onClear: () => void;
  onStop: () => void;
  onEdit: (turnId: string, text: string) => void;
  onRegenerate: () => void;
  onCopy: (text: string) => void;
  title: string;
  onNewChat: () => void;
  listConversations: () => ConversationSummary[];
  onOpenConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onToggleFollow: () => void;
}

interface ChatContainerApi extends Record<string, unknown> {
  addUserMessage(text: string, images?: ImageAttachment[], turnId?: string, selection?: SelectionScope): void;
  addAssistantMessage(text: string): void;
  cutMessages(turnId: string): void;
  addToolCall(name: string, input: Record<string, unknown>): number;
  updateToolResult(msgId: number, name: string, result: ToolResult): void;
  addError(text: string, errorKind?: "stopped"): void;
  showThinking(): void;
  hideThinking(): void;
  showAskUser(question: string): Promise<string>;
  cancelAskUser(): void;
  setInputEnabled(enabled: boolean): void;
  setBusy(busy: boolean): void;
  clearMessages(): void;
  focus(): void;
  setModel(name: string): void;
  setTitle(title: string): void;
  setSelection(selection: SelectionScope): void;
  getSelection(): SelectionScope | null;
  setEnterSends(on: boolean): void;
  /** Ctrl/Cmd+Enter in the chat: sends from the chat input, saves from a message's edit box. */
  sendFromKeyboard(target: EventTarget | null): boolean;
  /** Which turns can be edited or answered again. */
  setEditable?(check: (turnId: string) => boolean): void;
  setFollowEdits(on: boolean): void;
}

/**
 * Chat view for Chatting with AI.
 * Desktop: right sidebar. Mobile: right sidebar (slides in from edge).
 * Uses the plugin's shared AgentLoop and chatHistory so conversations
 * survive the view being closed and reopened (e.g. sidebar toggle).
 */
export class ObsidianChatView extends ItemView {
  private plugin: ChatPlugin;
  private chatContainer: ChatContainerApi | undefined;
  private running = false;
  private runVersion = 0;
  /** Some of the running turn's answer is on screen. */
  private answerShown = false;
  /** Lets the screen sleep again (the running turn holds it on). */
  private releaseScreen = (): void => {};
  /** Resolves once onOpen() has mounted the chat UI, or failed to. */
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: ChatPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.ready = new Promise((resolve) => { this.markReady = resolve; });
    // Obsidian takes Ctrl/Cmd+Enter as a hotkey before the input sees it.
    // The view's own scope is asked first, so the chat still sends with it.
    this.scope = new Scope(this.app?.scope);
    this.scope.register(["Mod"], "Enter", (evt) => this.chatContainer?.sendFromKeyboard(evt.target) ? false : true);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    // Distinct from upstream "Chat" tab so users running both plugins
    // side-by-side can tell the workspace tabs apart.
    return "Chatting with AI";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    try {
      this.mountChat();
      this.followKeyboardOnPhone();
    } finally {
      // Also when mounting failed: commands waiting for the view go on
      // (its methods do nothing without the UI) instead of waiting forever.
      this.markReady();
    }
  }

  /**
   * Phones: Obsidian doesn't shrink the sidebar for the keyboard, it only
   * sets --keyboard-height (and drops the sidebar's bottom padding). With
   * the keyboard open, measure how much of the view it covers and lift the
   * chat by that (`--ochatting-lift`, styles.css). Measured, not predicted:
   * whatever lies below the view, the input ends at the keyboard. Runs when
   * Obsidian changes the keyboard state (its style and class on <html> and
   * <body>) and when the view's size changes.
   */
  private followKeyboardOnPhone(): void {
    if (!Platform.isPhone) return;
    const view = this.contentEl;
    const update = () => {
      const keyboard = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--keyboard-height")) || 0;
      const rect = view.getBoundingClientRect();
      const lift = keyboard > 0 && rect.height > 0 ? Math.max(0, Math.round(rect.bottom - (window.innerHeight - keyboard))) : 0;
      view.style.setProperty("--ochatting-lift", `${lift}px`);
    };
    const resize = new ResizeObserver(update);
    resize.observe(view);
    const keyboardState = new MutationObserver(update);
    for (const el of [document.documentElement, document.body]) {
      keyboardState.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
    }
    this.register(() => {
      resize.disconnect();
      keyboardState.disconnect();
    });
  }

  private mountChat(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ochatting-view-container");

    this.chatContainer = mount<ChatContainerProps, ChatContainerApi>(
      ChatContainer as unknown as Component<ChatContainerProps, ChatContainerApi>,
      {
      target: container,
      props: {
        app: this.app,
        component: this,
        provider: this.plugin.settings.provider,
        model: this.plugin.modelHeaderLabel(),
        onSend: (text: string, selection: SelectionScope | null, images: ImageAttachment[]) => {
          void this.handleUserMessage(text, selection, images);
        },
        onClear: () => this.handleClear(),
        onStop: () => this.handleStop(),
        onEdit: (turnId: string, text: string) => void this.editMessage(turnId, text),
        onRegenerate: () => void this.regenerate(),
        onCopy: (text: string) => this.copyAnswer(text),
        title: this.plugin.activeConversation.title,
        onNewChat: () => this.newChat(),
        listConversations: () => this.plugin.listConversations(),
        onOpenConversation: (id: string) => this.openConversation(id),
        onRenameConversation: (id: string, title: string) => this.renameConversation(id, title),
        onDeleteConversation: (id: string) => this.deleteConversation(id),
        onToggleFollow: () => void this.toggleFollow(),
      },
    });

    this.renderHistory();
    this.updateEnterSends();
    this.updateFollowEdits();
    this.chatContainer.focus();
  }

  /** Show the active conversation's history in the UI, replacing what it shows. */
  renderHistory(): void {
    const chat = this.chatContainer;
    if (!chat) return;
    chat.clearMessages();
    for (const msg of this.plugin.chatHistory) {
      switch (msg.type) {
        case "user":
          chat.addUserMessage(msg.text ?? "", msg.images, msg.turnId, msg.selection);
          break;
        case "assistant":
          chat.addAssistantMessage(msg.text!);
          break;
        case "tool-result":
          if (msg.toolName && msg.toolResult) {
            const id = chat.addToolCall(msg.toolName, msg.toolInput || {});
            chat.updateToolResult(id, msg.toolName, msg.toolResult);
          }
          break;
        case "error":
          chat.addError(msg.text!, msg.errorKind);
          break;
      }
    }
    // Turns the API history no longer holds lose their pencil.
    this.updateEditable();
  }

  /** Turns the API history no longer holds lose their pencil and Regenerate. */
  private updateEditable(): void {
    const agent = this.plugin.agent;
    this.chatContainer?.setEditable?.((turnId) => agent.canEditTurn(turnId));
  }

  async onClose(): Promise<void> {
    this.handleStop();
    if (this.chatContainer) {
      await unmount(this.chatContainer);
      this.chatContainer = undefined;
    }
  }

  /** Programmatically send a message */
  sendMessage(text: string): void {
    void this.handleUserMessage(text, this.chatContainer?.getSelection() ?? null);
  }

  /** Set the selection scope and show the pill */
  setSelection(selection: SelectionScope): void {
    this.chatContainer?.setSelection(selection);
  }

  /** Focus the input */
  focus(): void {
    this.chatContainer?.focus();
  }

  /** Update the model display name in the header */
  updateModel(name: string): void {
    this.chatContainer?.setModel(name);
  }

  /** Enter sends, or starts a new line (the "Enter sends message" setting). */
  updateEnterSends(): void {
    this.chatContainer?.setEnterSends(this.plugin.settings.enterSends);
  }

  /** The eye button in the header shows the "Follow the AI's edits" setting. */
  updateFollowEdits(): void {
    this.chatContainer?.setFollowEdits(this.plugin.settings.followEdits);
  }

  /** The eye button: the "Follow the AI's edits" setting, on or off. */
  private async toggleFollow(): Promise<void> {
    this.plugin.settings.followEdits = !this.plugin.settings.followEdits;
    await this.plugin.saveSettings();
  }

  /** Clear conversation */
  clearConversation(): void {
    this.handleClear();
  }

  // ─── Conversations ──────────────────────────────────────────────────
  // Switching stops a running turn (as Stop does); what it showed stays in
  // its conversation.

  /** Start a new conversation (an empty current one is kept instead). */
  newChat(): void {
    if (this.running) this.stopTurn();
    this.plugin.startNewConversation();
    this.showConversation();
  }

  /** Switch to conversation `id`. */
  openConversation(id: string): void {
    if (id === this.plugin.activeConversationId) return;
    if (this.running) this.stopTurn();
    this.plugin.openConversation(id);
    this.showConversation();
  }

  /** Rename conversation `id` (empty: back to the automatic title). */
  renameConversation(id: string, title: string): void {
    this.plugin.renameConversation(id, title);
    this.chatContainer?.setTitle(this.plugin.activeConversation.title);
  }

  /** Delete conversation `id`; for the current one, show the next. */
  deleteConversation(id: string): void {
    const active = id === this.plugin.activeConversationId;
    if (active && this.running) this.stopTurn();
    this.plugin.deleteConversation(id);
    if (active) this.showConversation();
  }

  /** Show the active conversation, ready for input. */
  private showConversation(): void {
    const chat = this.chatContainer;
    if (!chat) return;
    chat.cancelAskUser();
    this.renderHistory();
    chat.setTitle(this.plugin.activeConversation.title);
    chat.setInputEnabled(true);
    chat.setBusy(false);
    chat.focus();
  }

  /**
   * Edit and continue: stop a running turn, cut both histories to
   * just before the turn `turnId`, save, and run `text` as a new turn with
   * that turn's images and selection scope. Vault changes stay. Resolves
   * when the new turn has ended.
   */
  async editMessage(turnId: string, text: string): Promise<void> {
    const history = this.plugin.chatHistory;
    const index = history.findIndex((entry) => entry.type === "user" && entry.turnId === turnId);
    // A turn the API history no longer holds can't be edited: cutting there
    // would leave the model without the chat.
    if (index < 0 || !this.plugin.agent.canEditTurn(turnId)) return;
    const { selection = null } = history[index];
    // Images the saved API history no longer holds can't be sent again.
    const images = (history[index].images ?? []).filter((image) => image.data);
    if (!text.trim() && images.length === 0) return;
    if (this.running) this.stopTurn();
    this.plugin.agent.cutBeforeTurn(turnId);
    this.plugin.chatHistory = history.slice(0, index);
    this.chatContainer?.cutMessages(turnId);
    // Saved at once: the cut holds even if the new turn never ends.
    void this.plugin.saveChatHistory();
    await this.handleUserMessage(text, selection, images);
  }

  /** Regenerate the last answer: run the last user turn again, unchanged. */
  async regenerate(): Promise<void> {
    const last = this.plugin.chatHistory.filter((entry) => entry.type === "user" && entry.turnId).pop();
    if (last?.turnId) await this.editMessage(last.turnId, last.text ?? "");
  }

  /** Copy an answer's Markdown source. */
  copyAnswer(text: string): void {
    void navigator.clipboard.writeText(text).then(
      () => new Notice("Copied"),
      () => new Notice("Couldn't copy the answer."),
    );
  }

  private async handleUserMessage(
    text: string,
    selection: SelectionScope | null,
    images: ImageAttachment[] = []
  ): Promise<void> {
    if (this.running) {
      new Notice("Please wait for the current response to complete.");
      return;
    }

    const chat = this.chatContainer;
    if (!chat) {
      // No UI (mounting it failed): nothing to show the turn in.
      new Notice("The chat panel couldn't be shown, so the message wasn't sent.");
      return;
    }
    const version = ++this.runVersion;
    const isCurrent = () => version === this.runVersion;
    const history = this.plugin.chatHistory;

    this.running = true;
    this.answerShown = false;
    // The screen stays on while the answer is generated.
    const releaseScreen = screenAwake.hold();
    this.releaseScreen = releaseScreen;
    const turnId = newTurnId();
    chat.addUserMessage(text, images, turnId, selection ?? undefined);
    history.push({ type: "user", text, images, turnId, ...(selection ? { selection } : {}) });
    this.plugin.touchConversation();
    chat.setTitle(this.plugin.activeConversation.title);
    chat.setInputEnabled(false);
    chat.setBusy(true);

    const toolCalls = new Map<string, { id: number; input: Record<string, unknown> }>();

    try {
      // The files the message links to go along as they are now; the chat
      // shows only the typed text.
      const app = this.plugin.app;
      const source = app.workspace.getActiveFile()?.path ?? "";
      const mentioned = await mentionContext(app, mentionedFiles(app, text, source));
      await this.plugin.agent.run(text, {
        onThinking: () => {
          chat.showThinking();
        },
        onToolCall: (name, input) => {
          chat.hideThinking();
          if (name === "ask_user") return;
          // A tool step on screen shows that the turn did something.
          this.answerShown = true;
          toolCalls.set(name, { id: chat.addToolCall(name, input), input });
        },
        onToolResult: (name, { focus, ...result }: ToolResult) => {
          if (name === "ask_user") return;
          const call = toolCalls.get(name);
          if (call) chat.updateToolResult(call.id, name, result);
          history.push({ type: "tool-result", toolName: name, toolInput: savedToolInput(call?.input ?? {}), toolResult: result });
          if (focus && !result.isError && this.plugin.settings.followEdits) this.follow(focus);
        },
        onResponse: (text) => {
          this.answerShown = true;
          chat.hideThinking();
          chat.addAssistantMessage(text);
          history.push({ type: "assistant", text });
        },
        onAskUser: async (question) => {
          // The question is the answer so far.
          this.answerShown = true;
          chat.hideThinking();
          chat.setInputEnabled(true);
          // The chat shows the question and the typed answer; keep both in
          // the history so they are still there after a reload.
          history.push({ type: "assistant", text: question });
          const answer = await chat.showAskUser(question);
          // Empty: Stop or Clear dropped the question.
          if (!answer || !isCurrent()) return "";
          history.push({ type: "user", text: answer });
          chat.setInputEnabled(false);
          return answer;
        },
        onError: (error) => {
          chat.hideThinking();
          chat.addError(error);
          history.push({ type: "error", text: error });
        },
      }, selection, images, turnId, mentioned);
    } catch (e) {
      if (!isCurrent()) return;
      const msg = e instanceof Error ? e.message : String(e);
      chat.addError(`Unexpected error: ${msg}`);
      history.push({ type: "error", text: `Unexpected error: ${msg}` });
    } finally {
      releaseScreen();
      if (isCurrent()) {
        // The history's limit may have cut older turns off.
        this.updateEditable();
        this.running = false;
        chat.setInputEnabled(true);
        chat.setBusy(false);
        chat.focus();
        // Persist after each turn
        void this.plugin.saveChatHistory();
      }
    }
  }

  /** Edits shown one after another, in the order the AI made them. */
  private following: Promise<unknown> = Promise.resolve();

  /** Show an edit the AI just made (setting "Follow the AI's edits"). */
  private follow(target: ViewTarget): void {
    this.following = this.following.then(() => showInView(this.plugin.app, target)).catch(() => undefined);
  }

  /** Stops the running turn; what it showed so far stays. */
  private stopTurn(): void {
    this.runVersion++;
    this.plugin.agent.abort();
    // A stopped request may still be waiting for its response.
    this.releaseScreen();
    this.running = false;
    // Otherwise the next message would answer the stopped turn's question.
    this.chatContainer?.cancelAskUser();
    this.chatContainer?.hideThinking();
  }

  private handleStop(): void {
    // Nothing of the answer is on screen yet: say that the turn was stopped.
    const silent = this.running && !this.answerShown;
    this.stopTurn();
    const chat = this.chatContainer;
    if (chat) {
      if (silent) chat.addError("Stopped.", "stopped");
      chat.setInputEnabled(true);
      chat.setBusy(false);
      chat.focus();
    }
    if (silent) this.plugin.chatHistory.push({ type: "error", text: "Stopped.", errorKind: "stopped" });
    void this.plugin.saveChatHistory();
  }

  private handleClear(): void {
    this.runVersion++;
    this.plugin.agent.clear();
    this.releaseScreen();
    this.plugin.chatHistory = [];
    this.plugin.touchConversation();
    this.chatContainer?.setTitle(this.plugin.activeConversation.title);
    this.chatContainer?.clearMessages();
    this.chatContainer?.cancelAskUser();
    this.running = false;
    this.chatContainer?.setInputEnabled(true);
    this.chatContainer?.setBusy(false);
    // Clear persisted state
    void this.plugin.saveChatHistory();
  }
}
