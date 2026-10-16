# Phase 3: PRs #31–#38

The author stack is cumulative, ending at `425d0c4beb12888197bfc40bff4577f8864a6872`. This branch starts at the Phase 2 candidate `5b419bf85d11d8b0bab9cb7c5a8c2c639f730441` and preserves its image limits, selection fingerprints, provider replay fixes, migration and validation repairs. Phase 2 was merged in PR #49 and published as 0.6.0; its formal Community release scan is pending.

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

Automated before native deployment: 416 tests, TypeScript, Svelte (zero errors/warnings) and production build passed. External review and official scanning are tracked below.

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

0.7.0 is candidate metadata in the single Phase 3 integration/release PR #50. No Phase 3 main-branch merge, tag or release has been created. Phase 2 is fully released as 0.6.0, including the formal Community scan and Current release update.

## External review, round 1

Head `f81dcd4db6aa23d15db69c952c149d3869653845` passed CI and its exact-head Community Preview (Completed, no Error/Fail, Dependencies Pass; only two compatibility API deprecation recommendations). Codex identified two issues:

- Folder renames/deletions discovered only ancestor instructions. Instruction discovery now walks the target folder and every descendant folder, including their destination scope on rename. Regression tests confirm no operation occurs until the model receives the rules, and a subsequent compliant retry executes once.
- Per-file/count limits allowed a combined request beyond provider limits. The picker checks combined encoded images/files; the send path checks attachments plus mentioned files together (20 MiB), and all three provider transports check the actual serialized UTF-8 request including history, tools and system text (30 MB, below Anthropic's 32 MB ceiling). Oversized input is refused with an actionable error; no attachments are silently dropped. An unsent turn preserves pending undo notes.

After these repairs, all 424 tests, TypeScript, Svelte (zero errors/warnings) and the production build pass. Fresh CI, Codex review and an exact-head Community Preview are required after push. The earlier native-device acceptance above covers the original integrated features; the new folder/request boundaries have automated regression coverage and are not represented as a new live-device acceptance run.

## External review, round 2

Head `e97562227f77cf84454afc831d0ac69c7906d1ef` passed CI and its exact-head Community Preview (Completed, no Error/Fail, Dependencies Pass). Codex found that an XLSX cell with an invalid column reference could expand a sparse row into millions of positions despite a small ZIP input.

Excel text extraction now validates references before indexing (at most XFD / row 1,048,576). It also bounds total expanded cells and CSV text across the workbook, covering valid sparse columns and repeated shared strings. If extraction exceeds these bounds or encounters invalid references, the existing attachment path keeps the original document without unsafe local text extraction. Regression tests cover malformed/huge references, the valid XFD boundary, many wide rows, shared-string amplification and a subsequent normal workbook. All 426 tests, TypeScript, Svelte (zero errors/warnings) and production build pass; fresh external review and an exact-head Preview are required after push.

## External review, round 3

Head `752adfd4dc310d4aac549d57248b4aff6baabbbc` passed CI and its exact-head Community Preview. Codex found three remaining boundaries:

- Mention resolution retained every large attachment before checking the combined budget. It now counts picked images/files first, checks document metadata before binary reads when the next file cannot fit, and checks actual encoded bytes after every loaded attachment. Oversized input aborts immediately without loading the rest.
- Content search did not report the files it read for folder instructions. Search now returns internal first-touch paths, including non-matches and canvases. The loop delivers the corresponding rules in the result and removes this metadata before UI/persistence; instructions are still supplied once per conversation.
- Rejected linked attachments left a visible-only user turn with no editable API history. The view now stages the user row until preflight succeeds and restores text, picked files/images and selection on preflight failure. Pending undo notes remain intact. Cancellation tests cover both a reused empty chat and switching from an existing conversation.

All 433 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. These repairs require fresh external review and an exact-head Preview after push.
