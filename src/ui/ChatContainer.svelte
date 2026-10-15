<script lang="ts">
  import type { App } from "obsidian";
  import { Component as ObsidianComponent, MarkdownRenderer, Notice } from "obsidian";
  import type { ToolResult, SelectionScope, ImageAttachment } from "../types";
  import { normalizeMathMarkdown } from "./math-markdown";
  import { toolLabel } from "./tool-label";

  const MAX_IMAGE_COUNT = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
  const SUPPORTED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ]);

  interface ChatMessage {
    id: number;
    type: "user" | "assistant" | "tool-call" | "tool-result" | "error" | "thinking";
    text?: string;
    images?: ImageAttachment[];
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: ToolResult;
  }

  interface Props {
    app: App;
    component: ObsidianComponent;
    provider: string;
    model: string;
    onSend: (text: string, selection: SelectionScope | null, images: ImageAttachment[]) => void;
    onClear: () => void;
    onStop: () => void;
  }

  let { app, component, provider, model, onSend, onClear, onStop }: Props = $props();

  let displayModel = $state("");
  let messages = $state<ChatMessage[]>([]);
  let inputText = $state("");
  let inputEnabled = $state(true);
  let placeholder = $state("Ask anything...");
  let messagesEl: HTMLElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let attachments = $state<ImageAttachment[]>([]);
  // The input shows a scrollbar only once its text is taller than it can grow.
  let inputScrollable = $state(false);
  let nextId = 0;

  // Selection scope (shown as a pill above input)
  let selection = $state<SelectionScope | null>(null);

  // ask_user support
  let askUserResolve: ((value: string) => void) | null = $state(null);

  // Sync model prop to local state (also updateable via setModel)
  $effect(() => {
    displayModel = model;
  });

  // ─── Scrolling: stick to the bottom, like a chat ──────────────────────
  // While the user is at the bottom, new messages keep the view there.
  // Scrolling up stops that, so earlier messages can be read while a turn
  // runs; back at the bottom it follows again. Sending a question always
  // brings the view down. While scrolled up, a button jumps back to the
  // bottom. Only scrolling up stops following: the browser also scrolls by
  // itself (content above changing height, a shorter list), which mustn't
  // leave the answer half hidden.
  /** Pixels from the bottom that still count as "at the bottom". */
  const BOTTOM_SLACK = 32;
  let messageListEl: HTMLElement | undefined = $state();
  let stickToBottom = true;
  let showJump = $state(false);
  let lastQuestionId = -1;
  let lastScrollTop = 0;

  function isAtBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
  }

  /** Follow new content while sticking to the bottom; otherwise offer the jump button. */
  function followBottom(): void {
    const el = messagesEl;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop = el.scrollTop;
      showJump = false;
    } else if (!isAtBottom(el)) {
      showJump = true;
    }
  }

  function jumpToBottom(): void {
    stickToBottom = true;
    followBottom();
  }

  // A new question (sent, or the history shown anew) brings the view down.
  $effect(() => {
    let lastId = -1;
    for (const msg of messages) if (msg.type === "user") lastId = msg.id;
    if (lastId !== lastQuestionId) {
      lastQuestionId = lastId;
      stickToBottom = true;
    }
    followBottom();
  });

  // Rendered Markdown, math, images, opened tool details and a resized panel
  // or phone keyboard change heights after the messages do.
  $effect(() => {
    const el = messagesEl;
    if (!el || !messageListEl) return;
    const observer = new ResizeObserver(() => followBottom());
    observer.observe(el, { box: "border-box" });
    observer.observe(messageListEl);
    // Scrolling up (wheel, touch, scrollbar, keys) stops following; back at the bottom it follows.
    const onScroll = () => {
      if (isAtBottom(el)) stickToBottom = true;
      else if (el.scrollTop < lastScrollTop) stickToBottom = false;
      lastScrollTop = el.scrollTop;
      showJump = !stickToBottom && !isAtBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  });

  // ─── Public API (called from chat-view.ts / chat-modal.ts) ────────────

  export function addUserMessage(text: string, images: ImageAttachment[] = []): void {
    messages.push({ id: nextId++, type: "user", text, images: images.slice() });
  }

  export function addAssistantMessage(text: string): void {
    messages.push({ id: nextId++, type: "assistant", text });
  }

  export function addToolCall(name: string, input: Record<string, unknown>): number {
    const id = nextId++;
    messages.push({ id, type: "tool-call", toolName: name, toolInput: input });
    return id;
  }

  export function updateToolResult(msgId: number, name: string, result: ToolResult): void {
    const msg = messages.find((m) => m.id === msgId);
    if (msg) {
      msg.type = "tool-result";
      msg.toolName = name;
      msg.toolResult = result;
    }
  }

  export function showThinking(): void {
    // Only add if not already showing
    if (!messages.some((m) => m.type === "thinking")) {
      messages.push({ id: nextId++, type: "thinking" });
    }
  }

  export function hideThinking(): void {
    const idx = messages.findIndex((m) => m.type === "thinking");
    if (idx !== -1) messages.splice(idx, 1);
  }

  export function addError(text: string): void {
    messages.push({ id: nextId++, type: "error", text });
  }

  export function showAskUser(question: string): Promise<string> {
    addAssistantMessage(question);
    placeholder = "Type your answer...";
    inputEnabled = true;
    textareaEl?.focus();

    return new Promise<string>((resolve) => {
      askUserResolve = resolve;
    });
  }

  /** Drop a pending ask_user question (its turn was stopped or cleared). */
  export function cancelAskUser(): void {
    const resolve = askUserResolve;
    askUserResolve = null;
    resolve?.("");
  }

  export function setInputEnabled(enabled: boolean): void {
    inputEnabled = enabled;
    placeholder = enabled ? "Ask anything..." : "Waiting for response...";
  }

  export function clearMessages(): void {
    messages = [];
    attachments = [];
    if (fileInputEl) fileInputEl.value = "";
    selection = null;
    hideThinking();
  }

  export function focus(): void {
    textareaEl?.focus();
  }

  /** Update the model display name in the header */
  export function setModel(name: string): void {
    displayModel = name;
  }

  /** Set the selection scope (shows pill in UI) */
  export function setSelection(sel: SelectionScope): void {
    selection = sel;
  }

  /** Get the current selection scope */
  export function getSelection(): SelectionScope | null {
    return selection;
  }

  /** Clear the selection scope */
  export function clearSelection(): void {
    selection = null;
  }

  // ─── Internal handlers ────────────────────────────────────────────────

  function handleSend(): void {
    const text = inputText.trim();
    if (!text && attachments.length === 0) return;

    if (askUserResolve && attachments.length > 0) {
      new Notice("Image attachments are not supported when answering a tool question.");
      return;
    }

    inputText = "";
    resetHeight();
    const sentImages = attachments.slice();
    attachments = [];

    if (askUserResolve) {
      addUserMessage(text);
      const resolve = askUserResolve;
      askUserResolve = null;
      resolve(text);
      return;
    }

    // Pass current selection and consume it (one-shot per send)
    const currentSelection = selection;
    selection = null;
    onSend(text, currentSelection, sentImages);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoGrow(): void {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 300) + "px";
    inputScrollable = textareaEl.scrollHeight > 300;
  }

  function resetHeight(): void {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    inputScrollable = false;
  }

  function imageDataUrl(image: ImageAttachment): string {
    return `data:${image.mediaType};base64,${image.data}`;
  }

  function openImagePicker(): void {
    if (inputEnabled) fileInputEl?.click();
  }

  async function handleImageSelection(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const files = Array.from(input.files ?? []);
    input.value = "";
    await addImageFiles(files);
  }

  function handlePaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  }

  async function addImageFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (attachments.length >= MAX_IMAGE_COUNT) {
        new Notice(`Attach up to ${MAX_IMAGE_COUNT} images per message.`);
        return;
      }

      try {
        const image = await readImageAttachment(file);
        const currentBytes = attachments.reduce((total, item) => total + item.sizeBytes, 0);
        if (currentBytes + image.sizeBytes > MAX_TOTAL_IMAGE_BYTES) {
          new Notice("The combined image size must be 12 MB or less per message.");
          return;
        }
        attachments = [...attachments, image];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Could not attach ${file.name || "image"}: ${message}`);
      }
    }
  }

  async function readImageAttachment(file: File): Promise<ImageAttachment> {
    let mediaType = file.type.toLowerCase() || inferImageMimeType(file.name);
    const isHeic = mediaType === "image/heic" || mediaType === "image/heif" ||
      /\.(heic|heif)$/i.test(file.name);
    let source: Blob = file;

    if (mediaType === "image/svg+xml") {
      throw new Error("SVG images are not supported. Choose a raster image instead.");
    }
    if (!mediaType.startsWith("image/")) {
      throw new Error("Choose an image file.");
    }

    if (isHeic || !SUPPORTED_IMAGE_TYPES.has(mediaType) || file.size > MAX_IMAGE_BYTES) {
      if (mediaType === "image/gif") {
        throw new Error("GIF files must be 5 MB or smaller.");
      }
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image conversion is unavailable.");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        mediaType = mediaType === "image/png" ? "image/png" : "image/jpeg";
        source = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("Image conversion failed.")),
            mediaType,
            0.85,
          );
        });
      } catch {
        throw new Error("This image could not be converted. Try JPEG or PNG instead.");
      }
    }

    if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
      throw new Error("Use a JPEG, PNG, GIF, or WebP image.");
    }
    if (source.size > MAX_IMAGE_BYTES) {
      throw new Error("Images must be 5 MB or smaller after conversion.");
    }

    const dataUrl = await readAsDataUrl(source);
    const comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("Image could not be read.");
    return {
      id: `image-${Date.now()}-${nextId++}`,
      fileName: file.name || `image.${mediaType.split("/")[1]}`,
      mediaType,
      data: dataUrl.slice(comma + 1),
      sizeBytes: source.size,
    };
  }

  function inferImageMimeType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    };
    return extension ? types[extension] ?? "" : "";
  }

  function readAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image could not be read."));
      reader.onerror = () => reject(new Error("Image could not be read."));
      reader.readAsDataURL(blob);
    });
  }

  function removeAttachment(id: string): void {
    attachments = attachments.filter((image) => image.id !== id);
  }

  // Render markdown into a DOM node using Obsidian's renderer. Each render
  // gets its own child component, unloaded when the text changes or the
  // message goes away; with the view itself as the component, everything
  // the renderer registers would stay loaded until the view closes. Math
  // delimiters are normalized for display only; the message stays unchanged.
  function markdown(node: HTMLElement, text: string) {
    let child: ObsidianComponent | null = null;
    const render = (value: string) => {
      if (child) component.removeChild(child);
      child = component.addChild(new ObsidianComponent());
      node.empty();
      MarkdownRenderer.render(app, normalizeMathMarkdown(value), node, "", child);
    };
    render(text);
    return {
      update: render,
      destroy() {
        if (child) component.removeChild(child);
      },
    };
  }

  function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.substring(0, max) + "\n... (truncated)";
  }
</script>

<div class="ochatting-container">
  <!-- Header -->
  <div class="ochatting-header">
    <div class="ochatting-header-left">
      <span class="ochatting-header-title">Chat</span>
      <span class="ochatting-header-model">{displayModel || "No model"}</span>
    </div>
    <!-- Nothing to clear in an empty chat: the trash folds away until there is -->
    <button
      class="ochatting-clear-btn"
      class:ochatting-clear-folded={messages.length === 0}
      type="button"
      onclick={onClear}
      tabindex={messages.length === 0 ? -1 : undefined}
      aria-hidden={messages.length === 0 ? "true" : undefined}
      aria-label="Clear conversation"
      title="Clear conversation"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
    </button>
  </div>

  <!-- Messages -->
  <div class="ochatting-messages" bind:this={messagesEl}>
    <div class="ochatting-message-list" bind:this={messageListEl}>
    {#each messages as msg (msg.id)}
      {#if msg.type === "user"}
        <div class="ochatting-msg ochatting-user-msg">
          {#if msg.images?.length}
            <div class="ochatting-user-images">
              {#each msg.images as image (image.id)}
                <img src={imageDataUrl(image)} alt={image.fileName} />
              {/each}
            </div>
          {/if}
          {#if msg.text}
            <div class="ochatting-msg-content">{msg.text}</div>
          {/if}
        </div>

      {:else if msg.type === "assistant"}
        <div class="ochatting-msg ochatting-assistant-msg">
          <div class="ochatting-msg-content" use:markdown={msg.text ?? ""}></div>
        </div>

      {:else if msg.type === "tool-call" || msg.type === "tool-result"}
        {@const state = msg.type === "tool-call" ? "running" : msg.toolResult?.isError ? "error" : "done"}
        <!-- One line per tool step ("Edited Plan"); parameters and result open on click -->
        <details class="ochatting-tool" class:is-error={state === "error"}>
          <summary class="ochatting-tool-row">
            {#if state === "running"}
              <span class="ochatting-spinner"></span>
            {:else if state === "error"}
              <svg class="ochatting-tool-icon" aria-label="Failed" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
            {:else}
              <svg class="ochatting-tool-icon" aria-label="Done" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
            {/if}
            <span class="ochatting-tool-label">{toolLabel(msg.toolName ?? "", msg.toolInput ?? {}, state)}</span>
            <span class="ochatting-tool-chevron" aria-hidden="true"></span>
          </summary>
          <div class="ochatting-tool-body">
            {#if msg.toolInput && Object.keys(msg.toolInput).length > 0}
              <div class="ochatting-tool-section">Parameters</div>
              <pre class="ochatting-tool-json">{truncate(JSON.stringify(msg.toolInput, null, 2), 2000)}</pre>
            {/if}
            {#if msg.toolResult}
              <div class="ochatting-tool-section">{state === "error" ? "Error" : "Result"}</div>
              <pre class="ochatting-tool-json">{truncate(msg.toolResult.result ?? "", 2000)}</pre>
            {/if}
          </div>
        </details>

      {:else if msg.type === "error"}
        <div class="ochatting-msg ochatting-error-msg">
          <div class="ochatting-msg-content">{msg.text}</div>
        </div>

      {:else if msg.type === "thinking"}
        <div class="ochatting-thinking">
          <span class="ochatting-dot"></span>
          <span class="ochatting-dot"></span>
          <span class="ochatting-dot"></span>
        </div>
      {/if}
    {/each}
    </div>
    {#if showJump}
      <!-- Scrolled up: back to the latest message (sticks to the view's bottom edge) -->
      <button class="ochatting-jump-btn" type="button" onclick={jumpToBottom} aria-label="Scroll to the latest message" title="Scroll to the latest message">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
      </button>
    {/if}
  </div>

  <!-- Selection pill -->
  {#if selection}
    <div class="ochatting-selection-pill">
      <div class="ochatting-selection-content">
        <span class="ochatting-selection-label">Selection from {selection.filePath.split("/").pop()}</span>
        <span class="ochatting-selection-preview">{selection.text.substring(0, 80)}{selection.text.length > 80 ? "..." : ""}</span>
      </div>
      <button
        class="ochatting-selection-dismiss"
        onclick={() => selection = null}
        aria-label="Remove selection"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  {/if}

  {#if attachments.length > 0}
    <div class="ochatting-attachment-tray" aria-label="Image attachments">
      {#each attachments as image (image.id)}
        <div class="ochatting-attachment-preview">
          <img src={imageDataUrl(image)} alt={image.fileName} />
          <span title={image.fileName}>{image.fileName}</span>
          <button
            class="ochatting-attachment-remove"
            type="button"
            onclick={() => removeAttachment(image.id)}
            disabled={!inputEnabled}
            aria-label={`Remove ${image.fileName}`}
          >×</button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Input bar -->
  <div class="ochatting-input-bar">
    <input
      bind:this={fileInputEl}
      class="ochatting-file-input"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
      multiple
      onchange={handleImageSelection}
      aria-label="Choose images"
    />
    <button
      class="ochatting-attach-btn"
      type="button"
      onclick={openImagePicker}
      disabled={!inputEnabled || attachments.length >= MAX_IMAGE_COUNT}
      aria-label="Attach images"
      title="Attach images"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
    </button>
    <textarea
      class="ochatting-input"
      class:ochatting-input-scrollable={inputScrollable}
      bind:this={textareaEl}
      bind:value={inputText}
      {placeholder}
      disabled={!inputEnabled}
      rows="1"
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      oninput={autoGrow}
    ></textarea>
    {#if inputEnabled}
      <button
        class="ochatting-send-btn"
        onclick={handleSend}
        aria-label="Send message"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
      </button>
    {:else}
      <button
        class="ochatting-send-btn ochatting-stop-btn"
        onclick={onStop}
        aria-label="Stop generation"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
      </button>
    {/if}
  </div>
</div>

<style>
  /* ─── Container ─────────────────────────────────────────────────────── */
  .ochatting-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ─── Header ────────────────────────────────────────────────────────── */
  .ochatting-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .ochatting-header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .ochatting-header-title {
    font-weight: var(--font-weight-bold, 600);
    font-size: var(--font-ui-medium);
    color: var(--text-normal);
  }

  .ochatting-header-model {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    /* Model name and thinking level can outgrow a phone-width panel */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Clear: a red trash icon (it empties the conversation) */
  .ochatting-clear-btn {
    width: 32px;
    height: 32px;
    min-width: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-s);
    background: none;
    box-shadow: none;
    color: var(--text-error);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: width 200ms ease, min-width 200ms ease, margin 200ms ease, opacity 150ms ease, transform 200ms ease;
  }

  .ochatting-clear-btn:hover {
    background: var(--background-modifier-hover);
  }

  /* Folds away in an empty chat */
  .ochatting-clear-folded {
    width: 0;
    min-width: 0;
    margin-right: -4px; /* takes the header's gap with it, so no empty space is left */
    opacity: 0;
    transform: scale(0.5);
    overflow: hidden;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .ochatting-clear-btn {
      transition: none;
    }
  }

  /* ─── Messages ──────────────────────────────────────────────────────── */
  .ochatting-messages {
    flex: 1 1 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* The view follows the bottom itself (followBottom); no anchoring jumps */
    overflow-anchor: none;
    padding: 12px;
    -webkit-user-select: text;
    user-select: text;
  }

  .ochatting-message-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Round "to the latest message" button, stuck to the bottom edge of the view */
  .ochatting-jump-btn {
    position: sticky;
    bottom: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 8px auto 0;
    padding: 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: 50%;
    background: var(--background-primary);
    color: var(--text-muted);
    box-shadow: var(--shadow-s);
    cursor: pointer;
  }

  .ochatting-jump-btn:hover {
    color: var(--text-normal);
  }

  .ochatting-msg {
    max-width: 90%;
    padding: 8px 12px;
    border-radius: var(--radius-m);
    line-height: 1.5;
    word-wrap: break-word;
    -webkit-user-select: text;
    user-select: text;
  }

  .ochatting-user-msg {
    align-self: flex-end;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-bottom-right-radius: var(--radius-s);
  }

  .ochatting-user-images {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }

  .ochatting-user-images img {
    max-width: min(100%, 280px);
    max-height: 220px;
    border-radius: var(--radius-s);
    object-fit: contain;
  }

  .ochatting-assistant-msg {
    align-self: flex-start;
    background: var(--background-secondary);
    color: var(--text-normal);
    border-bottom-left-radius: var(--radius-s);
  }

  .ochatting-assistant-msg :global(p:first-child) {
    margin-top: 0;
  }

  .ochatting-assistant-msg :global(p:last-child) {
    margin-bottom: 0;
  }

  .ochatting-error-msg {
    align-self: flex-start;
    background: var(--background-secondary);
    color: var(--text-error);
    border-left: 3px solid var(--text-error);
    font-size: var(--font-ui-smaller);
    max-width: 90%;
  }

  /* ─── Tool Calls ────────────────────────────────────────────────────── */
  /* A quiet line per tool step; consecutive steps sit close together */
  .ochatting-tool {
    align-self: stretch;
    max-width: 100%;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .ochatting-tool + .ochatting-tool {
    margin-top: -6px;
  }

  .ochatting-tool-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 4px;
    border-radius: var(--radius-s);
    cursor: pointer;
    list-style: none;
  }

  .ochatting-tool-row::-webkit-details-marker {
    display: none;
  }

  .ochatting-tool-row:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .ochatting-tool-icon,
  .ochatting-tool-row .ochatting-spinner {
    flex-shrink: 0;
    color: var(--text-faint);
  }

  .ochatting-tool-row .ochatting-spinner {
    width: 10px;
    height: 10px;
    border-width: 1.5px;
  }

  .ochatting-tool.is-error .ochatting-tool-icon,
  .ochatting-tool.is-error .ochatting-tool-label {
    color: var(--text-error);
  }

  .ochatting-tool-label {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A small chevron after the label, turned down when open */
  .ochatting-tool-chevron {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
    opacity: 0;
    transition: transform 150ms ease, opacity 150ms ease;
  }

  .ochatting-tool-row:hover .ochatting-tool-chevron,
  .ochatting-tool[open] .ochatting-tool-chevron {
    opacity: 0.7;
  }

  .ochatting-tool[open] .ochatting-tool-chevron {
    transform: rotate(45deg);
  }

  .ochatting-tool-body {
    margin: 2px 0 6px 22px;
  }

  .ochatting-tool-section {
    margin-top: 4px;
    color: var(--text-faint);
  }

  .ochatting-tool-json {
    margin: 4px 0 0;
    padding: 6px 8px;
    background: var(--background-primary);
    border-radius: var(--radius-s);
    font-size: 11px;
    max-height: 150px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* ─── Spinner ───────────────────────────────────────────────────────── */
  .ochatting-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-faint);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: ochatting-spin 0.6s linear infinite;
  }

  @keyframes ochatting-spin {
    to { transform: rotate(360deg); }
  }

  /* ─── Thinking Dots ─────────────────────────────────────────────────── */
  .ochatting-thinking {
    align-self: flex-start;
    display: flex;
    gap: 4px;
    padding: 8px 12px;
  }

  .ochatting-dot {
    width: 8px;
    height: 8px;
    background: var(--text-faint);
    border-radius: 50%;
    animation: ochatting-pulse 1.4s ease-in-out infinite;
  }

  .ochatting-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .ochatting-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes ochatting-pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* ─── Input Bar ─────────────────────────────────────────────────────── */
  .ochatting-file-input {
    display: none;
  }

  .ochatting-attachment-tray {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 8px 12px 0;
    flex-shrink: 0;
  }

  .ochatting-attachment-preview {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 190px;
    min-width: 190px;
    padding: 5px 28px 5px 5px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-secondary);
  }

  .ochatting-attachment-preview img {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    border-radius: 4px;
    object-fit: cover;
  }

  .ochatting-attachment-preview span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ochatting-attachment-remove {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    cursor: pointer;
  }

  .ochatting-attachment-remove:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* No safe-area inset here: Obsidian's containers already keep it free. */
  .ochatting-input-bar {
    /* The buttons and one line of the input share this height, so they line up. */
    --ochatting-control: 36px;
    display: flex;
    /* Buttons stay at the bottom while the input grows to more lines. */
    align-items: flex-end;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--background-modifier-border);
    background: transparent;
    flex-shrink: 0;
  }

  .ochatting-attach-btn {
    width: var(--ochatting-control);
    height: var(--ochatting-control);
    min-width: var(--ochatting-control);
    min-height: var(--ochatting-control);
    padding: 0;
    border: none;
    border-radius: 50%;
    /* A light circle the size of the send button; Obsidian's button shadow off */
    background: var(--background-modifier-hover);
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* Icons in proportion to the control size */
  .ochatting-attach-btn svg {
    width: calc(var(--ochatting-control) * 0.5);
    height: calc(var(--ochatting-control) * 0.5);
  }

  .ochatting-send-btn svg {
    width: calc(var(--ochatting-control) * 0.46);
    height: calc(var(--ochatting-control) * 0.46);
  }

  .ochatting-stop-btn svg {
    width: calc(var(--ochatting-control) * 0.4);
    height: calc(var(--ochatting-control) * 0.4);
  }

  .ochatting-attach-btn:hover {
    background: var(--background-modifier-active-hover);
    color: var(--text-normal);
  }

  .ochatting-attach-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .ochatting-input {
    flex: 1;
    resize: none;
    border: 1.5px solid var(--background-modifier-border-hover, var(--background-modifier-border));
    box-sizing: border-box;
    border-radius: calc(var(--ochatting-control) / 2);
    /* One line is exactly the control height: (height - line height - borders) / 2 */
    padding: calc((var(--ochatting-control) - 1.4em - 3px) / 2) 16px;
    min-height: var(--ochatting-control);
    font-size: var(--font-ui-medium);
    font-family: var(--font-interface);
    background-color: var(--background-secondary);
    color: var(--text-normal);
    line-height: 1.4;
    max-height: 300px;
    /* The height autoGrow() sets leaves out the borders, so the text
       overflowed it by 3px and showed an empty scrollbar track: a scrollbar
       only beyond the maximum height (autoGrow() turns it on). */
    overflow-y: hidden;
    box-shadow: none;
  }

  .ochatting-input-scrollable {
    overflow-y: auto;
  }

  .ochatting-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: none;
  }

  .ochatting-input:disabled {
    opacity: 0.5;
  }

  .ochatting-send-btn {
    width: var(--ochatting-control);
    height: var(--ochatting-control);
    min-width: var(--ochatting-control);
    min-height: var(--ochatting-control);
    padding: 0;
    border: none;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: none;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1px;
  }

  .ochatting-send-btn:hover {
    background-color: var(--interactive-accent-hover);
  }

  .ochatting-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ochatting-stop-btn {
    background-color: var(--text-error);
  }

  .ochatting-stop-btn:hover {
    background-color: var(--text-error);
    opacity: 0.85;
  }

  /* ─── Selection Pill ─────────────────────────────────────────────────── */
  .ochatting-selection-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 8px 0;
    padding: 6px 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    flex-shrink: 0;
  }

  .ochatting-selection-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ochatting-selection-label {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-weight: 500;
  }

  .ochatting-selection-preview {
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ochatting-selection-dismiss {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ochatting-selection-dismiss:hover {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  /* ─── Responsive ────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    .ochatting-msg {
      max-width: 95%;
    }

    .ochatting-input-bar {
      --ochatting-control: 44px; /* touch size */
      gap: 10px;
      padding: 10px 12px;
    }

    .ochatting-input {
      font-size: 16px; /* Prevents iOS zoom on focus */
    }
  }
</style>
