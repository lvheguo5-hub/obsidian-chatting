// A turn sent with a selection may change only the selected text of that
// note: the tools enforce it, the instruction in the message isn't enough.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, call, callbacks, response, settings, text, transport, vaultApp, readingSelectionSetup } from './harness.mjs';

const NOTE = '## Feedback\n- crowded plan\n- low contrast\n\n## Decisions\n- crowded plan stays grouped\n';
const SELECTED = '- crowded plan\n- low contrast';

function vault(notes) {
  const files = new Map(Object.entries(notes));
  const app = {
    workspace: { getActiveFile: () => ({ path: 'Review.md' }) },
    vault: {
      getFileByPath: path => files.has(path) ? { path } : null,
      getAbstractFileByPath: path => files.has(path) ? { path } : null,
      getFolderByPath: () => ({}),
      cachedRead: async file => files.get(file.path),
      process: async (file, fn) => { files.set(file.path, fn(files.get(file.path))); },
      modify: async (file, content) => { files.set(file.path, content); },
    },
    fileManager: {
      processFrontMatter: async () => { files.set('touched', 'yes'); },
      renameFile: async () => { files.set('touched', 'yes'); },
      trashFile: async () => { files.set('touched', 'yes'); },
    },
  };
  return { app, files };
}

const run = (app, name, input, scope) => api.executeTool(app, name, input, async () => 'yes', scope);

test('find_replace changes the text inside the selection, not an earlier match elsewhere', async () => {
  const { app, files } = vault({ 'Review.md': `Intro: - crowded plan\n\n${NOTE}` });
  const scope = { filePath: 'Review.md', text: SELECTED };
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- crowded plan', content: '- [ ] Group the plan by bed' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), 'Intro: - crowded plan\n\n## Feedback\n- [ ] Group the plan by bed\n- low contrast\n\n## Decisions\n- crowded plan stays grouped\n');
  // The scope follows the edit: the next edit in the turn finds the new text.
  assert.equal(scope.text, '- [ ] Group the plan by bed\n- low contrast');
  const second = await run(app, 'edit_document', { operation: 'find_replace', find: '- [ ] Group the plan by bed', content: '- [ ] Group by bed' }, scope);
  assert.equal(second.isError, false);
  assert.match(files.get('Review.md'), /## Feedback\n- \[ \] Group by bed\n- low contrast/);
});

test('Text outside the selection, a whole-note replace or an insert is refused; the note stays as it was', async () => {
  for (const input of [
    { operation: 'find_replace', find: '- crowded plan stays grouped', content: 'gone' },
    { operation: 'find_replace', find: '## Decisions', content: '## Done' },
    { operation: 'replace_all', content: 'everything new' },
    { operation: 'insert', position: 'end', content: 'more' },
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE });
    const result = await run(app, 'edit_document', { path: 'Review.md', ...input }, { filePath: 'Review.md', text: SELECTED });
    assert.equal(result.isError, true, input.operation);
    assert.match(result.result, /^Not changed:/);
    assert.equal(files.get('Review.md'), NOTE, input.operation);
  }
});

test('The selected note can\'t be renamed, deleted or get new properties; other notes stay editable', async () => {
  const scope = { filePath: 'Review.md', text: SELECTED };
  for (const [name, input] of [
    ['rename_file', { path: 'Review.md', new_path: 'Old.md' }],
    ['delete_file', { path: 'Review.md' }],
    ['set_properties', { path: 'Review.md', properties: { status: 'done' } }],
    ['set_properties', { properties: { status: 'done' } }],
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE });
    const result = await run(app, name, input, scope);
    assert.equal(result.isError, true, name);
    assert.match(result.result, /only that selection may change/);
    assert.equal(files.has('touched'), false, name);
  }
  const { app, files } = vault({ 'Review.md': NOTE, 'Tasks.md': 'Old' });
  const other = await run(app, 'edit_document', { path: 'Tasks.md', operation: 'replace_all', content: 'New' }, scope);
  assert.equal(other.isError, false);
  assert.equal(files.get('Tasks.md'), 'New');
});

test('A selected text that also appears earlier: the selected copy changes (by its offset), the earlier stays', async () => {
  const note = '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob\n';
  const from = note.lastIndexOf('- [ ] call Bob');
  const { app, files } = vault({ 'Review.md': note });
  const scope = { filePath: 'Review.md', text: '- [ ] call Bob', from };
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob about the quote' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob about the quote\n');
  // A second edit stays on the same copy.
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- [ ]', content: '- [x]' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [x] call Bob about the quote\n');
});

test('A folder the selected note is in can\'t be renamed or deleted', async () => {
  // The harness's normalizePath returns the path as given, so the trailing
  // slash and the root '/' below reach the guard unchanged.
  const scope = { filePath: 'Projects/Plan.md', text: 'x' };
  for (const [name, input] of [
    ['delete_file', { path: 'Projects' }],
    ['rename_file', { path: 'Projects/', new_path: 'Archive' }],
    ['delete_file', { path: '/' }],
  ]) {
    const { app, files } = vault({ 'Projects/Plan.md': 'x', 'Projects': '' });
    const result = await run(app, name, input, scope);
    assert.match(result.result, /only that selection may change/, `${name} ${input.path}`);
    assert.equal(files.has('touched'), false);
  }
  // A folder with a similar name is not the note's folder.
  const { app } = vault({ 'Projects/Plan.md': 'x', 'Projects-old': '' });
  const result = await run(app, 'delete_file', { path: 'Projects-old' }, scope);
  assert.equal(result.isError, false);
});

test('Text typed before the selection moves it: the snapshot keeps the original copy', async () => {
  const note = '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob\n';
  const scope = { filePath: 'Review.md', text: '- [ ] call Bob', from: note.lastIndexOf('- [ ] call Bob'), sourceText: note };
  // After selecting, the user adds a line just above the selected copy.
  const { app, files } = vault({ 'Review.md': note.replace('## Friday\n', '## Friday\n- [ ] buy milk\n') });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob about the quote' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] buy milk\n- [ ] call Bob about the quote\n');
  assert.equal(scope.from, files.get('Review.md').lastIndexOf('- [ ] call Bob'));
});

test('A line typed above both copies (more than the gap between them): the selected copy, counted from the top, changes', async () => {
  const note = '# List\n\n- [ ] Buy milk\n- [ ] Call Ana\n- [ ] Buy milk\n';
  const scope = { filePath: 'Review.md', text: 'Buy milk', from: note.lastIndexOf('Buy milk'), occurrence: 1, sourceText: note };
  // After selecting the second copy, the user types a line under the heading.
  const typed = note.replace('# List\n', '# List\nTyped above the list after selecting.\n');
  const { app, files } = vault({ 'Review.md': typed });
  const first = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'Buy milk', content: 'Buy oat milk' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), typed.replace(/Buy milk\n$/, 'Buy oat milk\n'));
  // The scope follows the edit: a second edit lands on the same copy.
  const second = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'oat milk', content: 'oat milk (2 l)' }, scope);
  assert.equal(second.isError, false);
  assert.match(files.get('Review.md'), /- \[ \] Buy milk\n- \[ \] Call Ana\n- \[ \] Buy oat milk \(2 l\)\n$/);
});

test('A note saved with CRLF line breaks: the selection (with LF, as the editor gives it) is found, the rest stays as it was', async () => {
  const note = '## Monday\n- [ ] call Bob\n- [ ] pay rent\n\n## Friday\n- [ ] call Bob\n- [ ] pay rent\n';
  const selected = '- [ ] call Bob\n- [ ] pay rent';
  const scope = { filePath: 'Review.md', text: selected, from: note.lastIndexOf(selected) };
  const { app, files } = vault({ 'Review.md': note.replace(/\n/g, '\r\n') });
  const first = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob\n- [ ] call Ann' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), '## Monday\r\n- [ ] call Bob\r\n- [ ] pay rent\r\n\r\n## Friday\r\n- [ ] call Bob\r\n- [ ] call Ann\r\n- [ ] pay rent\r\n');
  // The scope stays in the editor's terms, so the next edit lands on the same copy.
  assert.equal(scope.text, '- [ ] call Bob\n- [ ] call Ann\n- [ ] pay rent');
  assert.equal(scope.from, note.lastIndexOf(selected));
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'pay rent', content: 'pay rent today' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\r\n- [ ] call Bob\r\n- [ ] pay rent\r\n\r\n## Friday\r\n- [ ] call Bob\r\n- [ ] call Ann\r\n- [ ] pay rent today\r\n');
});

test('find matching more than once inside the selection changes the first and says so', async () => {
  const { app, files } = vault({ 'Review.md': NOTE });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- ', content: '* ' }, { filePath: 'Review.md', text: SELECTED });
  assert.match(result.result, /^\[Note: Multiple matches found in the selection, replacing first occurrence\.\]\nSuccessfully/);
  assert.equal(files.get('Review.md'), NOTE.replace('- crowded plan\n', '* crowded plan\n'));
});

test('Another note can be renamed or get properties during a selection turn', async () => {
  const scope = { filePath: 'Review.md', text: SELECTED };
  for (const [name, input] of [
    ['rename_file', { path: 'Tasks.md', new_path: 'Done/Tasks.md' }],
    ['set_properties', { path: 'Tasks.md', properties: { status: 'done' } }],
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE, 'Tasks.md': 'Old' });
    const result = await run(app, name, input, scope);
    assert.equal(result.isError, false, name);
    assert.equal(files.get('touched'), 'yes', name);
  }
});

test('selectionScope records where the selection starts, also when it was made backwards', () => {
  const lines = NOTE.split('\n');
  const editor = {
    getValue: () => NOTE,
    // Selected from the end of line 3 back to the start of line 2: the cursor is before the anchor.
    getCursor: which => which === 'from' ? { line: 1, ch: 0 } : { line: 2, ch: 14 },
    posToOffset: pos => lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch,
  };
  const scope = api.selectionScope(editor, SELECTED, 'Review.md');
  assert.deepEqual(scope, { text: SELECTED, filePath: 'Review.md', from: NOTE.indexOf(SELECTED), occurrence: 0, sourceText: NOTE });
  // A repeated text: the copies before the selected one are counted.
  const repeated = '- a\n- b\n- a\n';
  const second = { getValue: () => repeated, getCursor: () => ({ line: 2, ch: 0 }), posToOffset: pos => pos.line * 4 + pos.ch };
  assert.equal(api.selectionScope(second, '- a', 'Review.md').occurrence, 1);
});

test('A selection no longer in the note as selected (changed meanwhile) can\'t be edited', async () => {
  const { app, files } = vault({ 'Review.md': NOTE.replace('low contrast', 'contrast fixed') });
  const before = files.get('Review.md');
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- crowded plan', content: 'x' }, { filePath: 'Review.md', text: SELECTED });
  assert.match(result.result, /no longer in Review\.md as it was selected/);
  assert.equal(files.get('Review.md'), before);
});

test('In a chat turn with a selection the model can\'t change the rest of the note; without one it can', async () => {
  const { app, files } = vaultApp();
  files.set('Review.md', NOTE);
  const agent = new api.AgentLoop(app, settings('anthropic'));
  const requests = transport((body, index) => index === 0
    ? response('anthropic', [call('e1', 'edit_document', { path: 'Review.md', operation: 'replace_all', content: 'all new' })], 'tool_use')
    : response('anthropic', [text('Done.')]));
  const selection = { filePath: 'Review.md', text: SELECTED };
  await agent.run('Rewrite this as tasks', callbacks(), selection);
  assert.equal(files.get('Review.md'), NOTE);
  assert.match(JSON.stringify(requests[1]), /Not changed: the user selected text in Review\.md/);

  // The next turn has no selection: nothing is held back.
  transport((body, index) => index === 0
    ? response('anthropic', [call('e2', 'edit_document', { path: 'Review.md', operation: 'replace_all', content: 'all new' })], 'tool_use')
    : response('anthropic', [text('Done.')]));
  await agent.run('Now rewrite the whole note', callbacks(), null);
  assert.equal(files.get('Review.md'), 'all new');
});


test('A removed selected copy never redirects an edit to another identical copy', async () => {
  const original = 'first: task\nsecond: task\n';
  const scope = { filePath: 'Review.md', text: 'task', from: original.lastIndexOf('task'), occurrence: 1, sourceText: original };
  const changed = 'first: task\nsecond: gone\n';
  const { app, files } = vault({ 'Review.md': changed });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'task', content: 'DONE' }, scope);
  assert.equal(result.isError, true);
  assert.equal(files.get('Review.md'), changed);
});

test('Inserting a duplicate above the selection preserves the original selected copy', async () => {
  const original = 'heading\nselected: task\n';
  const scope = { filePath: 'Review.md', text: 'task', from: original.indexOf('task'), occurrence: 0, sourceText: original };
  const changed = 'task\n' + original;
  const { app, files } = vault({ 'Review.md': changed });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'task', content: 'DONE' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), 'task\nheading\nselected: DONE\n');
});


test('Deleting the whole selection finishes and subsequent edits are refused', async () => {
  const { app, files } = vault({ 'Review.md': 'before selected after' });
  const scope = { filePath: 'Review.md', text: 'selected', from: 7, sourceText: 'before selected after' };
  const first = await run(app, 'edit_document', { operation: 'find_replace', find: 'selected', content: '' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), 'before  after');
  const second = await run(app, 'edit_document', { operation: 'find_replace', find: 'after', content: 'oops' }, scope);
  assert.equal(second.isError, true);
  assert.equal(files.get('Review.md'), 'before  after');
});

test('A failed vault write leaves the selection tracking unchanged for a retry', async () => {
  const original = 'before selected after';
  const { app, files } = vault({ 'Review.md': original });
  const scope = { filePath: 'Review.md', text: 'selected', from: 7, sourceText: original };
  const before = { ...scope };
  const process = app.vault.process;
  app.vault.process = async (file, fn) => { fn(files.get(file.path)); throw new Error('write failed'); };
  const input = { operation: 'find_replace', find: 'selected', content: 'done' };
  assert.equal((await run(app, 'edit_document', input, scope)).isError, true);
  assert.deepEqual(scope, before);
  app.vault.process = process;
  assert.equal((await run(app, 'edit_document', input, scope)).isError, false);
  assert.equal(files.get('Review.md'), 'before done after');
});


test('Removing an adjacent identical selection is ambiguous and cannot edit its neighbour', async () => {
  const original = 'tasktask';
  const { app, files } = vault({ 'Review.md': 'task' });
  const scope = { filePath: 'Review.md', text: 'task', from: 0, sourceText: original };
  assert.equal((await run(app, 'edit_document', { operation: 'find_replace', find: 'task', content: 'DONE' }, scope)).isError, true);
  assert.equal(files.get('Review.md'), 'task');
});

test('CRLF additions before a repeated selection relocate from the original editor offset', async () => {
  const original = 'task\nheading\ntask\n';
  const changed = 'intro\n' + original;
  const { app, files } = vault({ 'Review.md': changed.replace(/\n/g, '\r\n') });
  const scope = { filePath: 'Review.md', text: 'task', from: original.lastIndexOf('task'), sourceText: original };
  assert.equal((await run(app, 'edit_document', { operation: 'find_replace', find: 'task', content: 'DONE' }, scope)).isError, false);
  assert.equal(files.get('Review.md'), 'intro\r\ntask\r\nheading\r\nDONE\r\n');
});

test('Text selected in a reading view is a scope of that note; elsewhere, or in an editing view, it isn\'t', () => {
  const inside = { id: 'rendered text' };
  const outside = { id: 'chat answer' };
  const note = (path, mode) => Object.assign(new api.MarkdownView(), {
    file: { path }, getMode: () => mode, previewMode: { containerEl: { contains: node => node === inside } },
  });
  const app = leaves => ({ workspace: { getLeavesOfType: type => type === 'markdown' ? leaves.map(view => ({ view })) : [] } });
  const selected = (text, anchorNode) => ({ toString: () => text, anchorNode });
  const reading = app([note('Draft.md', 'source'), note('Review.md', 'preview')]);

  assert.deepEqual(api.readingSelectionScope(reading, selected('  crowded plan\n', inside)), { filePath: 'Review.md', text: 'crowded plan' });
  assert.equal(api.readingSelectionScope(reading, selected('crowded plan', outside)), null);
  assert.equal(api.readingSelectionScope(reading, selected('   ', inside)), null);
  assert.equal(api.readingSelectionScope(reading, null), null);
  assert.equal(api.readingSelectionScope(app([note('Review.md', 'source')]), selected('crowded plan', inside)), null);
});

test('A reading-view selection that occurs more than once in the note can\'t be edited', async () => {
  const { app, files } = vault({ 'Review.md': NOTE });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'crowded', content: 'busy' }, { filePath: 'Review.md', text: 'crowded plan' });
  assert.equal(result.isError, true);
  assert.equal(files.get('Review.md'), NOTE);
});

test('An empty reading selection clears only the same automatic pill', () => {
  const automatic = { filePath: 'Review.md', text: SELECTED };
  const empty = { toString: () => '' };
  const clear = (current, tracked = automatic) => api.shouldClearReadingSelection(empty, current, tracked, false, Infinity);
  assert.equal(clear(automatic), true);
  assert.equal(api.shouldClearReadingSelection(null, automatic, automatic, false, Infinity), true);
  assert.equal(clear(null), false); // Dismissed or sent.
  assert.equal(clear({ ...automatic }), false); // Same text, a different pill.
  assert.equal(clear({ filePath: 'Other.md', text: 'other' }), false);
  assert.equal(clear(automatic, null), false); // No automatic selection.
});

test('Chat focus and the 1.5-second pointer handoff each protect the automatic pill', () => {
  const automatic = { filePath: 'Review.md', text: SELECTED };
  const clear = (focused, elapsed) => api.shouldClearReadingSelection(null, automatic, automatic, focused, elapsed);
  assert.equal(clear(true, Infinity), false);
  for (const elapsed of [0, 400, 1499, 1500]) assert.equal(clear(false, elapsed), false);
  assert.equal(clear(false, 1501), true);
});

test('Nonempty selections outside reading mode, including whitespace, never clear the pill', () => {
  const automatic = { filePath: 'Review.md', text: SELECTED };
  for (const value of ['chat answer', 'editor text', '   ']) {
    assert.equal(api.shouldClearReadingSelection({ toString: () => value }, automatic, automatic, false, Infinity), false);
  }
});

test('Reading selections replace the pill; clearing waits for 400 ms without another change', async t => {
  const { select, chat, view } = await readingSelectionSetup(t);
  select(SELECTED);
  t.mock.timers.tick(400);
  const first = view.getSelection();
  assert.deepEqual(first, { filePath: 'Review.md', text: SELECTED });
  select('new selection');
  t.mock.timers.tick(400);
  assert.notEqual(view.getSelection(), first);
  assert.equal(view.getSelection().text, 'new selection');

  select('');
  t.mock.timers.tick(399);
  assert.equal(chat.clears, 0);
  select(null);
  t.mock.timers.tick(399);
  assert.equal(chat.clears, 0);
  t.mock.timers.tick(1);
  assert.equal(chat.clears, 1);
  assert.equal(view.getSelection(), null);
});

test('Focus inside the chat preserves a reading pill even after the handoff grace expires', async t => {
  const { select, view, doc, chatNode, chat } = await readingSelectionSetup(t);
  select(SELECTED);
  t.mock.timers.tick(400);
  const automatic = view.getSelection();
  doc.activeElement = chatNode;
  select('');
  t.mock.timers.tick(2000);
  assert.equal(view.getSelection(), automatic);
  assert.equal(chat.clears, 0);
});

test('A chat pointerdown protects the pill before input focus arrives, but an outside click does not renew it', async t => {
  const { select, pointerDown, view, doc, noteNode } = await readingSelectionSetup(t);
  select(SELECTED);
  t.mock.timers.tick(400);
  const automatic = view.getSelection();
  pointerDown();
  assert.equal(doc.activeElement, null);
  select('');
  t.mock.timers.tick(400);
  assert.equal(view.getSelection(), automatic);
  t.mock.timers.tick(701);
  pointerDown(noteNode);
  select('');
  t.mock.timers.tick(400);
  assert.equal(view.getSelection(), null);
});

test('Selecting text in the chat leaves the reading pill alone', async t => {
  const { select, view, chatNode, chat } = await readingSelectionSetup(t);
  select(SELECTED);
  t.mock.timers.tick(400);
  const automatic = view.getSelection();
  for (const value of ['answer text', '   ']) {
    select(value, chatNode);
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), automatic);
  }
  assert.equal(chat.sets, 1);
  assert.equal(chat.clears, 0);
});

test('A dismissed, sent or replaced pill is not cleared by a pending selection change', async t => {
  const { select, view, chat } = await readingSelectionSetup(t);
  for (const action of ['dismiss', 'send', 'replace']) {
    select(SELECTED);
    t.mock.timers.tick(400);
    const automatic = view.getSelection();
    select('');
    if (action === 'replace') view.setSelection({ ...automatic });
    else chat.selection = null; // The component consumes or dismisses the pill.
    const current = view.getSelection();
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), current, action);
    assert.equal(chat.clears, 0, action);
  }
});

for (const source of ['command', 'menu']) {
  test(`An editor selection from the ${source} survives deselection, even with the same text`, async t => {
    const { plugin, view, chat, select, doc, commands, events } = await readingSelectionSetup(t);
    select(SELECTED);
    t.mock.timers.tick(400);
    const automatic = view.getSelection();
    plugin.openChat = async () => view;
    view.newChat = () => { chat.selection = null; };
    const editor = {
      getSelection: () => SELECTED, getValue: () => NOTE,
      getCursor: () => ({ line: 1, ch: 0 }), posToOffset: () => NOTE.indexOf(SELECTED),
    };
    const info = { file: { path: 'Review.md' } };
    if (source === 'command') {
      commands.get('send-selection').editorCheckCallback(false, editor, info);
    } else {
      let click;
      const item = { setTitle() { return this; }, setIcon() { return this; }, onClick(fn) { click = fn; } };
      events.get('editor-menu')({ addItem: fn => fn(item) }, editor, info);
      click();
    }
    await Promise.resolve();
    const manual = view.getSelection();
    assert.notEqual(manual, automatic);
    assert.equal(manual.text, SELECTED);
    doc.activeElement = null;
    select('');
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), manual);
    assert.equal(chat.clears, 0);
  });
}

test('Reading selection changes do nothing with the chat closed, including during the debounce', async t => {
  const { select, state, chat } = await readingSelectionSetup(t);
  state.open = false;
  select(SELECTED);
  t.mock.timers.tick(400);
  select('');
  t.mock.timers.tick(400);
  assert.equal(chat.sets, 0);
  assert.equal(chat.clears, 0);
  state.open = true;
  select(SELECTED);
  state.open = false;
  t.mock.timers.tick(400);
  assert.equal(chat.sets, 0);
});


test('PDF text is scoped to its file, including backwards selections across text layers', async t => {
  const { plugin, state, select, pdfNode, pdfEndNode, chatNode, pdf } = await readingSelectionSetup(t);
  select('  First\n\t line\u00a0\u00a0second   line  ', pdfEndNode, pdfNode);
  assert.deepEqual(api.readingSelectionScope(plugin.app, state.selection), {
    filePath: 'Reading/Report.pdf', text: 'First line second line',
  });
  select('outside', pdfNode, chatNode);
  assert.equal(api.readingSelectionScope(plugin.app, state.selection), null);
  select('   \n\t', pdfNode);
  assert.equal(api.readingSelectionScope(plugin.app, state.selection), null);
  select('text', pdfNode);
  pdf.file = null;
  assert.equal(api.readingSelectionScope(plugin.app, state.selection), null);
});

test('PDF selections settle for 400 ms, replace a reading pill and clear after deselection', async t => {
  const { select, view, chat, pdfNode } = await readingSelectionSetup(t);
  select(SELECTED);
  t.mock.timers.tick(400);
  const reading = view.getSelection();
  select('first', pdfNode);
  t.mock.timers.tick(399);
  assert.equal(view.getSelection(), reading);
  select(' first\n  second ', pdfNode);
  t.mock.timers.tick(399);
  assert.equal(view.getSelection(), reading);
  t.mock.timers.tick(1);
  assert.deepEqual(view.getSelection(), { filePath: 'Reading/Report.pdf', text: 'first second' });
  select('replacement', pdfNode);
  t.mock.timers.tick(400);
  assert.equal(view.getSelection().text, 'replacement');
  select('', pdfNode);
  t.mock.timers.tick(399);
  assert.equal(chat.clears, 0);
  select(null);
  t.mock.timers.tick(399);
  assert.equal(chat.clears, 0);
  t.mock.timers.tick(1);
  assert.equal(view.getSelection(), null);
  assert.equal(chat.clears, 1);
});

test('PDF pills keep the chat-focus, pointer-handoff and nonempty-selection exceptions', async t => {
  const { select, view, chat, pdfNode, doc, chatNode, pointerDown } = await readingSelectionSetup(t);
  select('excerpt', pdfNode);
  t.mock.timers.tick(400);
  const automatic = view.getSelection();
  assert.equal(automatic.filePath, 'Reading/Report.pdf');
  doc.activeElement = chatNode;
  select('');
  t.mock.timers.tick(2000);
  assert.equal(view.getSelection(), automatic);
  doc.activeElement = null;
  pointerDown();
  select('');
  t.mock.timers.tick(400);
  assert.equal(view.getSelection(), automatic);
  t.mock.timers.tick(1101);
  for (const value of ['answer text', '   ']) {
    select(value, chatNode);
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), automatic);
  }
  pointerDown(pdfNode);
  select('');
  t.mock.timers.tick(400);
  assert.equal(view.getSelection(), null);
  assert.equal(chat.clears, 1);
});

test('Dismissing, sending or manually replacing a PDF pill prevents automatic clearing', async t => {
  const { select, view, chat, pdfNode } = await readingSelectionSetup(t);
  for (const action of ['dismiss', 'send', 'replace']) {
    select('excerpt', pdfNode);
    t.mock.timers.tick(400);
    const automatic = view.getSelection();
    assert.equal(automatic.filePath, 'Reading/Report.pdf');
    select('');
    if (action === 'replace') view.setSelection({ ...automatic });
    else chat.selection = null;
    const current = view.getSelection();
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), current, action);
    assert.equal(chat.clears, 0, action);
  }
});

test('PDF selection changes do nothing while the chat is closed, including during debounce', async t => {
  const { select, state, chat, pdfNode } = await readingSelectionSetup(t);
  state.open = false;
  select('excerpt', pdfNode);
  t.mock.timers.tick(400);
  select('');
  t.mock.timers.tick(400);
  state.open = true;
  select('excerpt', pdfNode);
  state.open = false;
  t.mock.timers.tick(400);
  assert.equal(chat.sets, 0);
  assert.equal(chat.clears, 0);
});

test('PDF support leaves Markdown whitespace intact and ignores source and unrelated views', async t => {
  const { select, view, chat, note, noteNode } = await readingSelectionSetup(t);
  select('  First\n  second\tthird  ');
  t.mock.timers.tick(400);
  const reading = view.getSelection();
  assert.equal(reading.text, 'First\n  second\tthird');
  note.getMode = () => 'source';
  for (const node of [noteNode, { id: 'canvas text' }]) {
    select('other text', node);
    t.mock.timers.tick(400);
    assert.equal(view.getSelection(), reading);
  }
  assert.equal(chat.sets, 1);
  assert.equal(chat.clears, 0);
});

test('A PDF excerpt refuses writes before reading binary data, with a read-only explanation', async () => {
  for (const path of ['Reading/Report.pdf', 'Reading/Report.PDF']) {
    const scope = { filePath: path, text: 'excerpt' };
    const { app, files } = vault({ [path]: '%PDF binary', 'Tasks.md': 'Old' });
    app.workspace.getActiveFile = () => ({ path });
    app.vault.cachedRead = async () => assert.fail('must not read a PDF as text');
    app.vault.process = async () => assert.fail('must not process a PDF as text');
    for (const [name, input] of [
      ['edit_document', { path, operation: 'find_replace', find: 'excerpt', content: 'new' }],
      ['edit_document', { operation: 'find_replace', find: 'excerpt', content: 'new' }],
      ['edit_document', { path, operation: 'replace_all', content: 'new' }],
      ['edit_document', { path, operation: 'insert', position: 'end', content: 'new' }],
      ['set_properties', { path, properties: { status: 'done' } }],
      ['set_properties', { properties: { status: 'done' } }],
      ['edit_canvas', { path, operations: [] }],
      ['create_file', { path, content: 'new' }],
      ['rename_file', { path, new_path: 'Old.pdf' }],
      ['delete_file', { path }],
      ['rename_file', { path: 'Reading', new_path: 'Old' }],
      ['delete_file', { path: 'Reading/' }],
      ['delete_file', { path: '/' }],
    ]) {
      const result = await run(app, name, input, scope);
      assert.equal(result.isError, true, name);
      assert.match(result.result, /read-only.*PDF excerpt/, name);
      assert.doesNotMatch(result.result, /Use edit_document|select it again/, name);
    }
    assert.equal(files.get(path), '%PDF binary');
    assert.equal(files.has('touched'), false);
  }
  const { app, files } = vault({ 'Reading/Report.pdf': '%PDF binary', 'Tasks.md': 'Old' });
  const other = await run(app, 'edit_document', { path: 'Tasks.md', operation: 'replace_all', content: 'New' }, {
    filePath: 'Reading/Report.pdf', text: 'excerpt',
  });
  assert.equal(other.isError, false);
  assert.equal(files.get('Tasks.md'), 'New');
});

for (const provider of ['anthropic', 'openai', 'chatgpt-oauth']) {
  test(`${provider}: a PDF excerpt reaches the model as read-only context and attempted edits are refused`, async () => {
    api.setChatGPTOAuthService({ getUsableCredential: async () => ({ accessToken: 'fake-token', accountId: 'fake-account' }) });
    const { app, files } = vaultApp();
    const path = 'Reading/Report.pdf';
    files.set(path, '%PDF binary');
    const agent = new api.AgentLoop(app, settings(provider));
    const requests = transport((body, index) => index === 0
      ? response(provider, [call('e1', 'edit_document', { path, operation: 'find_replace', find: 'excerpt', content: 'new' })], 'tool_use')
      : response(provider, [text('Here is the rewritten excerpt.')]));
    const cb = callbacks();
    await agent.run('Rewrite this', cb, { filePath: path, text: 'excerpt' });
    assert.deepEqual(cb.errors, []);
    assert.equal(requests.length, 2);
    const sent = JSON.stringify(requests[0].messages ?? requests[0].input);
    assert.match(sent, /read-only excerpt from PDF Reading\/Report\.pdf/);
    assert.match(sent, /> excerpt/);
    assert.doesNotMatch(sent, /When using edit_document, use find_replace/);
    assert.match(JSON.stringify(requests[1]), /read-only.*PDF excerpt/);
    assert.equal(files.get(path), '%PDF binary');
  });
}
