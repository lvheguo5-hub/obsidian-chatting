/**
 * The one-line label of a tool step: what the AI does or did, with the
 * note or query it concerns ("Reading Plan…", "Edited Plan", "Editing
 * Plan failed"). Parameters and the result stay one click away.
 */

export type ToolState = "running" | "done" | "error";

/** Present ("Reading") while the tool runs or when it failed, past ("Read") once done. */
const VERBS: Record<string, [string, string]> = {
  read_document: ["Reading", "Read"],
  read_file: ["Reading", "Read"],
  edit_document: ["Editing", "Edited"],
  create_file: ["Creating", "Created"],
  open_document: ["Opening", "Opened"],
  get_properties: ["Reading the properties of", "Read the properties of"],
  set_properties: ["Updating the properties of", "Updated the properties of"],
  get_backlinks: ["Finding links to", "Found links to"],
  search_vault: ["Searching for", "Searched for"],
  list_files: ["Listing", "Listed"],
  rename_file: ["Renaming", "Renamed"],
  delete_file: ["Moving to the trash:", "Moved to the trash:"],
  get_current_datetime: ["Checking", "Checked"],
  ask_user: ["Asking a question", "Asked a question"],
};

/** A file path as a reader names it: the file name, without `.md`. */
export function fileLabel(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) return "the current note";
  const name = path.replace(/\/+$/, "").split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/** What the tool works on, as the label names it ("" when the verb says it all). */
function subject(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "search_vault":
      return `"${typeof input.query === "string" ? input.query : ""}"`;
    case "list_files":
      return typeof input.path === "string" && input.path.trim() ? fileLabel(input.path) : "the vault";
    case "rename_file":
      return `${fileLabel(input.path)} to ${fileLabel(input.new_path)}`;
    case "get_current_datetime":
      return "the date";
    case "ask_user":
      return "";
    default:
      return fileLabel(input.path);
  }
}

export function toolLabel(name: string, input: Record<string, unknown> = {}, state: ToolState = "done"): string {
  const verbs = VERBS[name];
  if (!verbs) {
    const plain = name.replace(/_/g, " ");
    return state === "running" ? `${plain}…` : state === "error" ? `${plain} failed` : plain;
  }
  const [present, past] = verbs;
  const what = subject(name, input);
  const [doing, done] = what ? [`${present} ${what}`, `${past} ${what}`] : [present, past];
  if (state === "running") return `${doing}…`;
  if (state === "error") return `${doing} failed`;
  return done;
}
