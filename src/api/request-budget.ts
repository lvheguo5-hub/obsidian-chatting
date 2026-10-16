/** Plugin-wide transport ceiling, below the smallest supported API limit
 * (Anthropic Messages: 32 MB). Count the actual encoded JSON, including
 * history, system/tools, base64 images/files and provider replay blocks.
 * https://platform.claude.com/docs/en/api/errors#request-size-limits
 */
export const MAX_REQUEST_BYTES = 30_000_000;

export class RequestBudgetError extends Error {
  constructor() {
    super("This request exceeds the 30 MB chat limit. Remove some attachments or start a new chat to reduce its history.");
    this.name = "RequestBudgetError";
  }
}

export function serializeRequest(body: Record<string, unknown>): string {
  const json = JSON.stringify(body);
  if (json.length > MAX_REQUEST_BYTES || new TextEncoder().encode(json).byteLength > MAX_REQUEST_BYTES) {
    throw new RequestBudgetError();
  }
  return json;
}
