# Chatting with AI

Agentic AI chat plugin for Obsidian. Simple, mobile-first, three providers (Anthropic + OpenAI + ChatGPT account sign-in).

## Architecture

```
User Input -> Agent Loop -> API Client (requestUrl) -> Anthropic/OpenAI/Codex
                 |                                         |
            Tool Executor  <---  tool_use response  <------+
                 |
         Obsidian Vault APIs (read/edit/search/create)
```

- **API clients** use `requestUrl()` (not `fetch`) because mobile WebViews enforce CORS
- **Anthropic** uses Messages API with adaptive thinking and prompt caching
- **OpenAI** uses Responses API with `previous_response_id` for multi-turn
- **ChatGPT account** uses the ChatGPT/Codex backend with Device Authorization Flow credentials in `SecretStorage`
- **Agent loop** is provider-agnostic: send -> tools -> send -> done
- **UI** is a single Svelte 5 component (`ChatContainer.svelte`) mounted in an `ItemView`

## Project Structure

```
src/
  main.ts                # Plugin entry: commands, views, settings, context menus
  types.ts               # All interfaces and defaults
  settings.ts            # PluginSettingTab with model fetching
  debug.ts               # Debug log (the "Debug log" setting)
  api/
    client.ts            # Dispatcher: routes to anthropic, openai, or ChatGPT OAuth adapter
    anthropic.ts         # Messages API, adaptive thinking, cache_control
    openai.ts            # Responses API, previous_response_id chaining
  tools/
    registry.ts          # 19 tool definitions (JSON Schema)
    executor.ts          # Runs tools against Obsidian Vault APIs
    metadata-query.ts    # query_notes, list_metadata (metadata cache, no file read)
    links.ts             # get_links: linked and unlinked mentions, outgoing links
    canvas.ts            # JSON Canvas: outline, search texts, node/edge operations
    web-page.ts          # read_web_page: a page's main content as Markdown
  agent/
    loop.ts              # Core agentic loop with selection scope
    context.ts           # Builds vault context (active file, selection)
    system-prompt.ts     # Static system prompt (KV cache optimized)
  ui/
    chat-view.ts         # ItemView wrapper, mounts Svelte component
    ChatContainer.svelte # All chat UI: messages, input, selection pill
    math-markdown.ts     # Render-time fix-up: math delimiters, table wiki links
    tool-label.ts        # One-line labels of tool steps ("Edited Plan")
  platform/
    screen-awake.ts      # Keeps the screen on while an answer is generated
```

## Key Patterns

- **KV cache optimization**: System prompt is static (never includes dynamic context). Dynamic context (active file, selection) goes in the user message after the cached prefix.
- **Anthropic `cache_control`**: Breakpoints on system prompt and last tool definition.
- **Thinking level from the model catalog**: The setting offers the levels the catalog lists for the selected model (Codex `supported_reasoning_levels`, Anthropic `/v1/models` `capabilities.effort`); Anthropic's thinking mode comes from `capabilities.thinking.types`. Without catalog data the previous rules apply: Anthropic thinking by model name, Codex `medium` for reasoning models, and OpenAI API-key requests `medium` for reasoning models (its model list has no levels).
- **Per-provider API keys**: Stored as `chatting-with-ai-api-key-anthropic` / `chatting-with-ai-api-key-openai` in `SecretStorage`.
- **In-memory chat persistence**: `AgentLoop` and `chatHistory` live on the plugin instance, surviving view open/close cycles.
- **Selection scope**: Injected into user message with scoping instructions, and enforced by `executeTool` for that turn: in the selected note only `edit_document` `find_replace` inside the selection (located by its offset and in-memory editor snapshot; changes outside the range can relocate it, while changed or ambiguous selections are refused) succeeds; other changes to that note, or renaming/deleting a folder it is in, are refused. Other notes stay editable.
- **Panel layout**: The chat view turns off Obsidian's `.view-content` padding and scrolling (`styles.css`) and pads its own parts. On desktop it keeps the bottom padding, which keeps it clear of the status bar (not needed in the left sidebar). In the phone sidebar it keeps 24px for the tab menu's fade below and turns off the 48px fade over the view with the floating navigation; Obsidian doesn't shrink the sidebar for the keyboard, so `chat-view.ts` measures how much of the view the keyboard covers and lifts the chat by that (`--ochatting-lift`). The safe area is left to Obsidian's containers.

## Build

```bash
npm install
npm run build          # Production
npm run dev            # Watch mode
npx tsc --noEmit       # Type check
npm run svelte-check   # Svelte check
```

## Tools

| Tool | Obsidian API | Notes |
|------|-------------|-------|
| read_document | `vault.cachedRead()` | Falls back to active file if no path |
| edit_document | `vault.process()` | Atomic read-modify-write |
| search_vault | `getMarkdownFiles()` + `.canvas` files + `cachedRead()` | Linear scan, capped; in canvases card text and labels only |
| read_file | `vault.getFileByPath()` + `cachedRead()` | Text files; images and binary files refused |
| create_file | `vault.create()` | Auto-creates parent folders |
| list_files | `vault.getFiles()` | Capped at 100 results |
| rename_file | `fileManager.renameFile()` | Updates all links |
| delete_file | `fileManager.trashFile()` | Respects user trash setting |
| open_document | `workspace.getLeaf().openFile()` | Opens file in editor |
| get_properties | `metadataCache.getFileCache()` | Reads YAML frontmatter |
| set_properties | `fileManager.processFrontMatter()` | Safe YAML merge/remove |
| get_links | `metadataCache.resolvedLinks` / `unresolvedLinks` + `cachedRead()` | Linked and unlinked mentions, outgoing links; the old name `get_backlinks` still runs |
| get_current_datetime | `Date` | User's locale and timezone |
| ask_user | UI callback | Pauses agent loop |
| query_notes | `metadataCache.getFileCache()` + `getAllTags()` | Tags (nested too), properties, folder; sorted; capped at 200 |
| list_metadata | `metadataCache.getFileCache()` + `getAllTags()` | Tags and properties with counts |
| read_canvas | `vault.cachedRead()` | Outline: groups, nodes, edges with IDs and positions |
| edit_canvas | `vault.process()` | Node/edge operations, all or nothing; keeps unknown fields |
| read_web_page | `requestUrl()` + `htmlToMarkdown()` | http(s) only; article/main content, 40,000 characters per call; loaded from the user's device |

## Debug

Turn on **Debug log** in the settings to write each message as sent (with its context lines), the model's answers with their text and tool calls, each tool call with its input and result, and errors to `<vault-config-dir>/plugins/chatting-with-ai/debug.log` (`src/debug.ts`). It includes the user's messages, never keys or tokens. The row's Copy and Clear buttons and the "Copy debug log" command get it off a phone.
