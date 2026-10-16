# Phase 3: PRs #31–#38

The author stack is cumulative, ending at `425d0c4beb12888197bfc40bff4577f8864a6872`. This branch starts at the Phase 2 candidate `5b419bf85d11d8b0bab9cb7c5a8c2c639f730441` and preserves its image limits, selection fingerprints, provider replay fixes, migration and validation repairs. Phase 2 stays unchanged while its official Community scan is pending.

## Scope

| PR | Feature | Integration checks |
| --- | --- | --- |
| #31 | Vault and folder AGENTS.md | New folder rules reach the model before the first write, including read/write calls in one batch. |
| #32 | Named conversations | v1/v2 → v3 migration, separate API histories, switch/rename/delete, restart recovery; cancellation during mention loading. |
| #33 | Follow edits | Native note opens at the changed range; dedicated follow tab and phone behavior. |
| #34 | Note mentions | Live linked-note context, input completion, capped text, pre-read source size checks. |
| #35 | Undo per answer | Successful trash operations only; partial failure stops and remains retryable; successful reverse steps are consumed; conflict confirmation holds off new turns and switching. |
| #36 | Fold finished steps | Folded native tool/undo row, restored history, error and ask_user handling. |
| #37 | PDF/Office/text files | Provider formats, native DOCX extraction/read, ZIP budget, source size checks, file history pruning. |
| #38 | Skills | Native metadata discovery, model use_skill, slash invocation and settings tests. |

## Repairs during integration

- Folder rules discovered in a batch defer writes until the next model response; a preceding read in that same batch does not count as already received by the model.
- Tool-returned files age out after two turns, and the newest four fitting 10 MiB of actual binary/extracted text are retained. This applies to requests, agent memory, inactive restored conversations and saved records. Existing user attachment behavior is preserved.
- Undo commits deletion records only after trash succeeds. Reverse operations stop on failure, consume successful steps, and leave the button available for retry. A partial failure is described accurately to the model. Deleted-file conflicts restore original binary content after confirmation. Delete snapshots are capped at 1000 files / 32 MiB before allocation where file metadata is available.
- File reads, mentions and the picker check source size before binary allocation and validate again afterward. Canvas outlines use the mention text budget.
- Conversation switching during async mention/skill loading prevents the old request from running in the new conversation. Pending undo notes survive cancellation before the agent starts.
- Persisted conversations reject duplicate/empty IDs, malformed file blocks, duplicate visible attachment IDs and invalid changes rows, recovering a readable copy through the existing recovery path. Selection snapshots remain compact fingerprints.

## Validation

Automated: 416 tests, TypeScript, Svelte (zero errors/warnings) and production build passed before native deployment. No fresh external Codex review or official Community scan has yet been performed for this branch.

Desktop native Obsidian 1.13.7, isolated `ob 插件测试` vault, production ChatGPT provider:

- 39 existing visible history entries survived v2 → v3 migration.
- Actual use_skill, linked-note context, read and surgical edit returned `PHASE3-DESKTOP-OK QUARTZ-731 PHASE3-SKILL-OK`.
- Undo restored the original Plan.md content while preserving SAFE. The native UI showed the folded “Undid the changes to Plan · 3 steps” row, the followed note and the chat list.
- Second conversation returned `PHASE3-SECOND-CHAT-OK`, with exactly one user turn in its API history. Switching back restored the renamed first conversation.
- A valid DOCX generated with python-docx was actually read through read_file and the live ChatGPT backend returned `PHASE3-DOCX-QUARTZ`. A deliberately minimal ZIP fixture was not accepted as a readable document by the backend and is not counted as a passing document test.

Phone: physical iPhone Air, Obsidian 1.14.5, iOS 27.0.1, production ChatGPT gpt-6.1-sol medium:

- First run correctly failed because the new fixtures were not yet in the device's vault index. Files.app subsequently showed the four synced fixtures and previewed Valid.docx correctly; after Obsidian reloaded, the actual workflow succeeded. No failed run is counted as a pass.
- use_skill, linked-note context, read/edit and DOCX read returned `PHASE3-PHONE-PASS`, `QUARTZ-731`, `PHASE3-DOCX-QUARTZ` and `PHASE3-SKILL-OK`. Plan.md changed only TARGET → VERIFIED and retained SAFE.
- The actual Undo button restored SAFE / TARGET and the row changed to “Undid the changes to Plan · 5 steps”.
- New chat returned `PHASE3-PHONE-SECOND-OK`; selecting the original chat in Chats restored its reply and undone row. A cold app restart restored that active conversation and its saved undo status; a new real request re-read Plan.md and returned `PHASE3-PHONE-RESTART-OK`, confirming the original SAFE / TARGET content and retained sign-in.
- Existing ChatGPT sign-in was used on each device. No credentials were copied.

Native reports are in `/Volumes/StudioSSD/Developer/BuildScratch/ChattingPhase3`. Desktop plugin reload retained all five conversations and its active DOCX reply. Final protected-file hash comparisons cover 1803 pre-existing desktop files and 1807 pre-existing phone-vault files: all 3610 are unchanged. Only isolated QA vaults are used; the main vault is not accessed.

## Release state

0.7.0 is candidate metadata on this development branch. The development branch is pushed with code integration commit `c441b1eea157330af57d7483dc74e71372f2b026`; its clean archive rebuild passed all 416 tests and checks, and all three asset SHA-256 values match. No third-phase integration PR, main-branch merge, tag or release has been created. The existing second-phase PR remains the only active integration/release PR. External review and official scanning remain required before release.
