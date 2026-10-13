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
  images.ts              # Image limits and re-encoding for view_image and view_canvas
  chat-state.ts          # Saved chat format (chat-state.json), one-time migrations
  api/
    client.ts            # Dispatcher: routes to anthropic, openai, or ChatGPT OAuth adapter
    anthropic.ts         # Messages API, adaptive thinking, cache_control
    openai.ts            # Responses API, previous_response_id chaining
  tools/
    registry.ts          # 21 tool definitions (JSON Schema)
    executor.ts          # Runs tools against Obsidian Vault APIs
    metadata-query.ts    # query_notes, list_metadata (metadata cache, no file read)
    links.ts             # get_links: linked and unlinked mentions, outgoing links
    canvas.ts            # JSON Canvas: outline, search texts, node/edge operations
    canvas-render.ts     # view_canvas: draws a canvas with Canvas 2D, plus a legend
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
    send-key.ts          # Which key sends (or saves an edit): "Enter sends message"
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
- **Turn IDs**: Each user turn has an ID on its `chatHistory` entry and on its first message in `AgentLoop` (`ask_user` answers have none). Editing a message or regenerating the last answer cuts both histories just before that turn (`cutBeforeTurn`; a new array, so OpenAI replays it in full) and runs the turn again with its images and selection. Chats saved before turn IDs get them in the one-time migration of `chat-state.json` (`assignLegacyTurnIds`, only while no turn has one).
- **Images in tool results**: `ToolResult.images` (`view_image`, `view_canvas`) go to the model inside the tool result (Anthropic image blocks; OpenAI and ChatGPT `function_call_output` as an `input_text` + `input_image` list). Only the agent history keeps them; the chat view and its saved `chatHistory` get the text and "[1 image sent to the model]". Requests leave out the images of tool results older than the last 2 user turns, with a note in their place (`withoutOldToolImages`); the stored history keeps them, and attached images are always sent.
- **Saved chat format**: `chat-state.json` has a `version` (2); a file without one is version 1. Older formats are migrated once on load (`migrateChatState` in `src/chat-state.ts`) and the next save writes the current one. A newer version than the plugin knows (saved by a later release, before a downgrade) isn't read: it is copied to `chat-state.v<version>-<time>.json` and the chat starts empty, so the next save doesn't overwrite it. Image data is saved only in the API history; the visible history keeps each image's ID, name, type and size and gets the data back by ID on load (`restoreImages`). An image the API history no longer holds shows as a chip with its name and isn't sent again on edit or regenerate.

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
| read_file | `vault.getFileByPath()` + `cachedRead()` | Text files; images (use view_image) and binary files refused |
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
| view_image | `vault.readBinary()` + `createImageBitmap()` | PNG, JPEG, GIF, WebP; over 2048 px or 5 MB scaled down (GIFs never re-encoded) |
| view_canvas | `vault.cachedRead()` + Canvas 2D | PNG of the layout (at most 1600 px) and a legend of node tags; `focus` zooms to a group or node |

## Debug

Turn on **Debug log** in the settings to write each message as sent (with its context lines), the model's answers with their text and tool calls, each tool call with its input and result, and errors to `<vault-config-dir>/plugins/chatting-with-ai/debug.log` (`src/debug.ts`). It includes the user's messages, never keys or tokens. The row's Copy and Clear buttons and the "Copy debug log" command get it off a phone.
