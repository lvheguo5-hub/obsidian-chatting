/** Desktop-only loopback OAuth. Loaded only after the platform check. */
import { Platform } from "obsidian";

// Only the small HTTP surface used here; mobile never loads the desktop module.
interface ServerResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(text: string): void;
}
interface IncomingMessage { url?: string; method?: string; }
interface CallbackServer {
  close(): void;
  closeAllConnections(): void;
  headersTimeout: number;
  requestTimeout: number;
  once(event: string, callback: (...args: never[]) => void): void;
  off(event: string, callback: (...args: never[]) => void): void;
  on(event: string, callback: () => void): void;
  listen(port: number, hostname: string): void;
}
interface HttpModule {
  createServer(callback: (req: IncomingMessage, res: ServerResponse) => void): CallbackServer;
}
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface BrowserLogin {
  authUrl: string;
  promise: Promise<void>;
  cancel: () => void;
}

export async function startBrowserLogin(
  exchange: (code: string, verifier: string, redirectUri: string, isCancelled: () => boolean) => Promise<void>,
): Promise<BrowserLogin> {
  let http: HttpModule;
  if (Platform.isDesktop) {
    // Electron's renderer cannot dynamically import node:http. Load it only here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    http = require("http") as HttpModule;
  } else {
    throw new Error("Use device-code login on mobile.");
  }
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  let cancelled = false;
  let finished = false;
  let exchanging = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // The caller attaches its UI handler after the listener starts.
  void promise.catch(() => {});
  let timer: number | undefined;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    if (error) cancelled = true;
    window.clearTimeout(timer);
    server.close();
    if (cancelled) server.closeAllConnections();
    if (error) reject(error); else resolve();
  };
  const reply = (res: ServerResponse, status: number, text: string) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Connection": "close" });
    res.end(text);
  };
  let redirectUri = "";
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET" || url.pathname !== "/auth/callback") {
      reply(res, 404, "Not found.");
      return;
    }
    if (url.searchParams.get("state") !== state) {
      reply(res, 400, "Invalid login state. Return to Obsidian and try again.");
      return;
    }
    if (finished || exchanging) {
      reply(res, 409, "This login is already being processed or has ended.");
      return;
    }
    if (url.searchParams.has("error")) {
      reply(res, 400, "Sign-in was not completed. Return to Obsidian to try again.");
      finish(new Error("ChatGPT sign-in was declined. Try again or use a device code."));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      reply(res, 400, "Missing authorization code.");
      return;
    }
    exchanging = true;
    void exchange(code, verifier, redirectUri, () => cancelled).then(() => {
      if (cancelled) return;
      reply(res, 200, "ChatGPT connected. You can return to Obsidian and close this tab.");
      finish();
    }).catch(() => {
      reply(res, 400, "Sign-in could not be completed. Return to Obsidian and try again.");
      finish(new Error("ChatGPT sign-in could not be completed. Try again or use a device code."));
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  // Both ports are on the Codex redirect allow-list. Never stop another app's listener.
  for (const port of [1455, 1457]) {
    try {
      await new Promise<void>((yes, no) => {
        const failed = (error: Error) => { server.off("listening", ready); no(error); };
        const ready = () => { server.off("error", failed); yes(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(port, "127.0.0.1");
      });
      redirectUri = `http://localhost:${port}/auth/callback`;
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE" || port === 1457) {
        server.close();
        throw new Error("Browser login could not open a local callback. Use a device code instead.");
      }
    }
  }
  server.on("error", () => finish(new Error("ChatGPT login callback stopped. Try again or use a device code.")));
  timer = window.setTimeout(() => {
    cancelled = true;
    finish(new Error("ChatGPT login timed out. Start the login again."));
  }, 15 * 60 * 1000);
  const url = new URL("https://auth.openai.com/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "chatting-with-ai",
  }).toString();
  return {
    authUrl: url.toString(), promise,
    cancel: () => { cancelled = true; finish(new Error("ChatGPT login was cancelled.")); },
  };
}
