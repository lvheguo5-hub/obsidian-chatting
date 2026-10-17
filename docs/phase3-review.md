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

Desktop supplement for `f662080`: the updated candidate was loaded only in the isolated desktop QA vault. The mounted native Svelte component restored the prompt and picked-file chip after a linked-document budget refusal; visible user rows stayed at zero and the agent stayed empty. This was verified through Obsidian's native CLI/DOM, without a provider request; no screenshot or new phone acceptance is claimed. The first harness waited on an inactive animation frame, so its pending CLI was terminated after independent DOM verification, fixture cleanup and a saved test-vault reload. Only the newly created budget fixture was removed.

## External review, round 4

Head `f662080721467978d2c14e61f9243debc4a3ecef` passed CI and its exact-head Community Preview. Codex found that final request-size rejection (after retained history is encoded) also needed preflight rollback, and that get_links needed to report every note it read.

- Final JSON-size rejection is now a typed error preserved outside the network wrappers. If it rejects the first request, the loop restores its prior API history and clears provider cursors for safe replay; the view removes the pending visible turn and restores the complete draft/selection and undo notes. A smaller retry can send without clearing the existing conversation. Regression tests exercise all three providers with individually valid attachments and retained history over the transport ceiling. Later failures after model/tool work keep that work intact.
- get_links reports all linked/unlinked source reads through instructionPaths, including non-matches. The existing result path adds their rules, avoids repeating the target folder rules in that result, and strips internal paths before UI/persistence.

All 437 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. Fresh review, CI and an exact-head Preview remain required for the repair commit.

## External review, round 5

Head `09bf74619aa7d394a38e8ddb7d092a59269b873c` passed CI and its exact-head Community Preview. Four further findings are repaired:

- A later request enlarged by tool attachments now drops only tool images/files, adds an explicit omission/error note, resets response cursors and retries within the same model iteration. Existing user attachments, tool pairing and completed work stay intact; a later text turn can continue. UI markers say attachments are prepared, since preparation does not prove transport succeeded.
- Linked-file and slash-skill contexts report their loaded paths. The loop supplies their folder rules before the initial user context; those deliveries count for later tool discovery. It calculates known rules against the history that will survive pruning, so an aged-out rule is delivered again.
- use_skill reports its loaded SKILL.md path for the same folder-rule mechanism.
- Attachment preparation has a pending flag and generation guard. Sending is disabled while files/images are read or parsed; reset, conversation change, restoration and teardown invalidate old completions. A stale completion cannot append to a new draft or unlock its newer pending load.

All 444 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. Fresh external review and exact-head Preview are required again.


Desktop supplement for `8114a20`: the clean-rebuilt candidate passed the mounted native Svelte attachment-loading check in the isolated desktop vault. Send and keyboard send stayed blocked while a deferred attachment was loading; starting a new chat invalidated the old completion, which added no chip and did not lock the new composer. Existing draft text remained intact. This was local DOM verification without a provider request or vault-file fixture; no newer phone acceptance is claimed. Evidence: `desktop-loading-8114a20.json` in the Phase 3 scratch directory. The harness initially expected New chat to clear draft text; the corrected assertion verifies the existing draft-preservation behavior separately from the loading guard.

## External review, round 6

Head `8114a20ecf1e2adab5a7c300c199d2ac7fdd6054` passed CI and its exact-head Community Preview (Completed, dependencies Pass, no Error/Fail). The scan also warned about assignment to a catch parameter; the retry handler now uses a separate local variable.

Codex found that recognizing instruction headers in ordinary user/linked/tool text allowed a forged marker to suppress real folder rules. Delivery is now recorded only in internal `instructionSources` metadata created by the folder instruction loader, independently of all content text. Initial linked/skill context and tool results retain this provenance through save/restore and pruning; old histories without provenance safely reload the real rules. Provider adapters transmit the rules' text, never the bookkeeping metadata. Regression tests cover typed text, text blocks, tool results, linked notes, spoofed markers inside actual instruction files, save/restore, and re-delivery after history pruning.

All 449 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. Fresh review, CI and an exact-head Preview are required for the repair commit.


## External review, round 7

Head `e4d2ee7a0851a99630a72ebc20622af018a80d03` passed CI and exact-head Community Preview (Completed, no Error/Fail, dependencies Pass). Codex found three additional boundaries:

- Edit/regenerate now retains the original API/visible histories until replacement preflight succeeds. Rejected linked context or final JSON budget restores all original turns, their object identity (including undo logs), title and pending notes, plus the unsent replacement draft. The premature cut is no longer saved. Stop/switch during asynchronous edited-context loading also restores the source conversation before leaving.
- view_canvas reports every embedded image file it actually reads in instructionPaths. The agent delivers those folder rules along with the picture; offscreen/focused-out nodes and nonimage cards do not imply reads.
- Undo retention coalesces adjacent edits to the same file with matching boundaries. It is bounded to 32 MiB per answer and 64 MiB across live logs, counting UTF-16 text and binary snapshots conservatively. Exceeding a budget expires a whole answer's undo, retaining only its changed-file names and showing the kept state; partial undo is never offered. New oversized answers report the limitation in a notice and tool result. Older evicted rows lose Undo, including on conversation restore. Weak references do not extend conversation lifetime; successful undo releases the consumed budget.

All 458 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. Regression coverage includes rejected edit/regenerate persistence, later-answer preservation, cancellation during context loading, a smaller retry, actual Canvas pixel/rule delivery, repeated large edits, whole-log expiration, global retention and UI/undo refusal after expiration. These boundary checks are automated; no additional phone acceptance is claimed. Fresh external review and exact-head Preview are required after push.


## External review, round 8

Head `e29383acf2b444494201c188d236481c973f981a` passed CI and exact-head Community Preview (Completed, no Error/Fail, dependencies Pass). Three Codex findings are repaired:

- A selection-only turn now discovers the selected file's folder rules before the first provider request, even when no tool is called. Trusted provenance deduplicates delivery in retained history and re-delivers after clear.
- Automatic titles and their original source turn are retained separately from the displayed custom name. Persistence pruning no longer changes the title on reload, append or removal of a temporary custom name. Editing the original first turn resets its title source; editing a later retained turn cannot replace a pruned original title. Legacy capped records preserve their saved automatic title when the source is unknown. Optional metadata remains compatible with format version 3.
- Undo marks the composer as locked/busy while awaiting conflict checks, confirmation and reverse operations, then unlocks in finally. The send button and keyboard path refuse before consuming text, selection or attachments; ongoing attachment preparation is not cancelled. A raced/programmatic submission also restores its complete draft.

All 462 tests, TypeScript, Svelte (zero errors/warnings) and production build pass. Regressions cover selection summaries without tools, multiple capped save/reload/append/rename cycles, legacy title retention and draft/attachment restoration during delayed undo. The desktop isolated vault additionally ran the actual mounted Svelte composer with a deferred in-memory undo conflict check: send stayed disabled, keyboard send consumed no draft or attachment and added no user turn, and send re-enabled after completion. This local UI supplement made no provider request or vault file operation; its temporary row/draft was removed and saved. Evidence: `desktop-undo-composer-round8.json` in the Phase 3 scratch directory. The desktop candidate assets were updated; the phone remains the originally tested candidate, with no new phone acceptance claimed.

Fresh review, CI and exact-head Community Preview are required again after push.
