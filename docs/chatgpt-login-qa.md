# ChatGPT login update — 2026-10-15

Desktop now offers **Sign in with ChatGPT** (browser OAuth with PKCE) and **Use device code**. Mobile keeps device authorization with a combined **Copy code and open login page** action, code expiry and return-to-Obsidian instructions, and device-login enablement guidance.

The previous implementation supported device authorization only. This installed mobile flow does **not** meet the user's code-free sign-in requirement. Physical-device research now proves browser-to-Obsidian protocol callbacks work. OpenAI's new OSS Sign in with ChatGPT flow still specifies an HTTP `127.0.0.1` callback, and its authorization endpoint rejected our `obsidian://` redirect. A hosted success page alone does not remove that requirement. See [mobile OAuth research](mobile-oauth-research.md) for tested boundaries and the distinction between the existing Codex adapter and the new official plan-usage flow.

Sources checked:

- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/app-server#3-log-in-with-chatgpt-browser-flow
- OpenAI Codex `codex-rs/login/src/server.rs`: allowed loopback ports 1455 and 1457, PKCE, state, authorization parameters. The plugin requests identity/offline-access scopes only.

Validation:

- 208 automated tests passed, including a real loopback listener with synthetic authorization callbacks: state rejection, S256 verifier/challenge, cancellation during exchange, occupied port fallback without stopping another app, duplicate callback rejection, and mobile browser-login refusal.
- TypeScript and Svelte checks passed (0 errors / 0 warnings); production build passed.
- Native Obsidian 1.13.7 in the isolated desktop vault loaded the production bundle, started `localhost:1455/auth/callback` with S256, and cancelled/released the callback. This caught and fixed an Electron module-loader incompatibility that Node-only tests did not catch.
- Native settings rendering showed both desktop login buttons. A synthetic device authorization in the real modal copied the test code, opened the expected official URL (browser/clipboard calls intercepted), and showed return instructions. No real account was authorized in this check.
- Latest build copied to the isolated iCloud vault `Chatting Phase1 QA`, with matching local SHA-256. QA companion remains disabled. Phone-side reload/entry verification is recorded below when completed.

Remaining acceptance: user completes real account sign-in on iPhone Air, returns to Obsidian, confirms Connected, sends a real request, and checks that the session survives a full app restart. New desktop browser OAuth also needs a real authorization completion; the earlier desktop live model check used the existing device-flow credential. Neither synthetic callback tests nor the prior mocked phone agent prove these remaining results.
