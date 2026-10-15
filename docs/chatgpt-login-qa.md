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

## Physical iPhone live acceptance — 2026-10-15

The user completed ChatGPT sign-in on iPhone and deferred credential handoff / further code-free mobile login work. The installed production plugin now passed live phone acceptance with `gpt-6.1-sol` / `medium`, without a companion or injected model/tool callbacks:

- Settings showed Connected; the real connection test returned `Hello`.
- A 298-character Chinese draft passed exact readback. The production agent read two test-vault files, created `QA/Phone-Live-20261015.md`, and read it back. The final reply and inline/display math rendered; success tool parameters and result expanded correctly.
- After terminating the process and reopening Obsidian, chat and tool results restored. A live follow-up continued the previous task without another login, replaced the new note's marker, set a boolean frontmatter property, and read both back.
- An intentionally missing-file read displayed Failed with its actual error and parameters; the agent continued and completed the remaining work. Ten production tool calls returned nine successes and this one expected failure.
- Independent iCloud readback confirmed marker `IPHONE-LIVE-20261015-B` and `mobile_qa_passed: true`. All 1,797 original visible test-vault files retained their hashes; only the new QA note was added. The main vault was not accessed.

Sanitized evidence: [phase1-iphone-live-qa.json](phase1-iphone-live-qa.json). The `devicectl --terminate-existing` relaunch reported CoreDeviceError 10004 after the running app exited; SpringBoard was observed, then the Obsidian icon was tapped to reopen. History restoration and the following live request passed. This records a tooling failure without assuming an app-crash cause.

Remaining boundaries: account-entry/consent screens were completed by the user before this run, not replayed. Forced token expiry/refresh, API-key providers, and new desktop browser OAuth completion are not covered by this phone acceptance. The earlier desktop live model check used an existing device-flow credential. Mobile code-free login and credential handoff are deferred, not reported as delivered. No merge or release performed.
