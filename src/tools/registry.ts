import type { UnifiedToolDef } from "../types";

/**
 * All 9 tools the agent can call. Deliberately minimal:
 * read, edit, search, create, list, rename, delete, and ask-user.
 */
export const TOOL_DEFINITIONS: UnifiedToolDef[] = [
  {
    name: "read_document",
    description:
      "Read the content of a markdown document. If no path is given, reads the currently active document.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document relative to vault root. Omit to read the active document.",
        },
      },
      required: [],
    },
  },
  {
    name: "edit_document",
    description:
      "Edit a markdown document. Supports three operations: 'replace_all' replaces the entire content, 'find_replace' finds a specific string and replaces it, 'insert' adds content at a position.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to edit the active document.",
        },
        operation: {
          type: "string",
          enum: ["replace_all", "find_replace", "insert"],
          description: "The type of edit to perform.",
        },
        content: {
          type: "string",
          description: "The new content (for replace_all), replacement text (for find_replace), or text to insert.",
        },
        find: {
          type: "string",
          description: "The exact text to find (required for find_replace).",
        },
        position: {
          type: "string",
          enum: ["beginning", "end", "after_frontmatter"],
          description: "Where to insert content (required for insert). 'after_frontmatter' inserts after the --- block.",
        },
      },
      required: ["operation", "content"],
    },
  },
  {
    name: "search_vault",
    description:
      "Search for files in the vault by filename or content. Returns matching file paths and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (matched against filenames and optionally content).",
        },
        searchContent: {
          type: "boolean",
          description: "Whether to also search inside file contents (slower). Default: false.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return. Default: 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read the full content of any text file in the vault by its path. Images and other binary files are refused.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file in the vault. Fails if the file already exists. IMPORTANT: The filename is the title in Obsidian, so never start content with an H1 heading that repeats the filename.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path for the new file relative to vault root (e.g. 'Notes/meeting.md').",
        },
        content: {
          type: "string",
          description: "Content of the new file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List files in the vault, optionally filtered by folder and/or extension.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Folder path to list (e.g. 'Projects'). Omit to list all files.",
        },
        extension: {
          type: "string",
          description: "Filter by file extension (e.g. 'md'). Omit to include all types.",
        },
      },
      required: [],
    },
  },
  {
    name: "rename_file",
    description: "Rename or move a file in the vault. Can be used to rename a note or move it to a different folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Current path of the file relative to vault root.",
        },
        new_path: {
          type: "string",
          description: "New path for the file relative to vault root.",
        },
      },
      required: ["path", "new_path"],
    },
  },
  {
    name: "delete_file",
    description: "Move a file to the Obsidian trash. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the file to delete relative to vault root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_properties",
    description:
      "Read the YAML frontmatter properties of a markdown document as structured data. Returns tags, aliases, and all custom properties.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document.",
        },
      },
      required: [],
    },
  },
  {
    name: "set_properties",
    description:
      "Set or update YAML frontmatter properties on a markdown document. Merges with existing properties. Set a value to null to remove a property.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document.",
        },
        properties: {
          type: "object",
          description: "Key-value pairs to set in the frontmatter. Arrays (like tags) are supported. Set a value to null to remove that property.",
        },
      },
      required: ["properties"],
    },
  },
  {
    name: "query_notes",
    description:
      "Find notes by tags and properties (frontmatter), e.g. all notes tagged #project with status 'active', sorted by due date. Uses Obsidian's metadata cache, so it is fast and reads no note. Returns paths with each note's tags and the properties asked about. Use list_metadata first if you don't know which tags or properties exist.",
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags the notes must have, with or without '#'. A tag also matches its nested tags (#project matches #project/alpha).",
        },
        match: {
          type: "string",
          enum: ["all", "any"],
          description: "Whether notes need all of the tags (default) or any of them.",
        },
        properties: {
          type: "object",
          description: "Property filters: name → value. A note matches when the property equals the value (case-insensitive; for list properties, when the list contains it; links match their note name). Use null to require only that the property is set.",
        },
        folder: {
          type: "string",
          description: "Only notes in this folder (and its subfolders).",
        },
        sort_by: {
          type: "string",
          description: "'path' (default), 'modified' (newest first), or a property name (ascending; notes without it last).",
        },
        limit: {
          type: "number",
          description: "Maximum notes listed (default 50, max 200).",
        },
      },
      required: [],
    },
  },
  {
    name: "list_metadata",
    description:
      "List the tags and property names used in the vault (or a folder), with how many notes use each and an example value per property. Use it to learn the vault's tags and properties before query_notes.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Only notes in this folder (and its subfolders).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_links",
    description:
      "A note's links, like Obsidian's Backlinks and Outgoing links panes: linked mentions (notes that link to it, with the lines), unlinked mentions (notes whose text names it or an alias without a link, any case) and outgoing links (including links to notes that don't exist yet).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_current_datetime",
    description:
      "Get the current date and time in the user's local timezone. Useful for daily notes, journaling, scheduling, or any time-aware task.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "open_document",
    description:
      "Open a document in the Obsidian editor. Use this when the user wants to navigate to, view, or open a specific file.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the user a clarifying question. Use this when you need more information before proceeding. The conversation will pause until the user responds.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user.",
        },
      },
      required: ["question"],
    },
  },
];
