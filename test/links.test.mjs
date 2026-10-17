// get_links against a fake metadata cache: linked mentions with their
// lines, unlinked mentions (name or alias, any case, not inside links or
// properties), outgoing links, and the earlier name get_backlinks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, settings, transport, response, text, call, callbacks } from './harness.mjs';

const TEXT = {
  'Garden.md': '---\naliases: [Veg patch]\n---\nSee [[Seeds]] and [[Compost]].',
  'Plan.md': 'Intro\nWork on the [[Garden#Beds|beds]] today.\nThen the garden shed.',
  'Diary.md': '---\ntopic: Garden\n---\nThe veg patch needs water.\nGardening is fun.\nGarden again.',
  'Seeds.md': 'Nothing here.',
};
// Offsets of the link in Plan.md and of the front matter in Diary.md.
const planLink = TEXT['Plan.md'].indexOf('[[Garden');
const diaryProps = TEXT['Diary.md'].indexOf('\nThe veg');
const CACHE = {
  'Garden.md': { frontmatter: { aliases: ['Veg patch'] } },
  'Plan.md': { links: [{ link: 'Garden#Beds', position: { start: { line: 1, offset: planLink }, end: { line: 1, offset: planLink + 21 } } }] },
  'Diary.md': { frontmatterPosition: { start: { line: 0, offset: 0 }, end: { line: 2, offset: diaryProps } } },
  'Seeds.md': {},
};

function linksApp() {
  const files = Object.keys(TEXT).map(path => ({ path, extension: 'md', basename: path.replace(/\.md$/, '') }));
  const byPath = path => files.find(file => file.path === path) ?? null;
  return {
    vault: { getMarkdownFiles: () => files, getFileByPath: byPath, cachedRead: async file => TEXT[file.path] },
    workspace: { getActiveFile: () => byPath('Garden.md') },
    metadataCache: {
      getFileCache: file => CACHE[file.path] ?? null,
      getFirstLinkpathDest: linkpath => byPath(`${linkpath}.md`),
      resolvedLinks: { 'Plan.md': { 'Garden.md': 1 }, 'Garden.md': { 'Seeds.md': 1 }, 'Diary.md': {} },
      unresolvedLinks: { 'Garden.md': { Compost: 1 } },
    },
  };
}

test('get_links: linked mentions with the line, unlinked mentions by name or alias, outgoing links', async () => {
  const { result, isError, instructionPaths } = await api.executeTool(linksApp(), 'get_links', {}, async () => '');
  assert.deepEqual([...instructionPaths].sort(), Object.keys(TEXT).sort());
  assert.equal(isError, false);
  assert.match(result, /Linked mentions \(1 note\):\n- Plan\.md \(1 link\)\n  > Work on the \[\[Garden#Beds\|beds\]\] today\./);
  // "garden shed" in Plan.md and "veg patch" and "Garden again" in Diary.md; not
  // "Gardening", not the link, not the property.
  assert.match(result, /Unlinked mentions \(2 notes; to link one, edit it to \[\[Garden\]\]\):/);
  assert.match(result, /- Diary\.md \(2 lines\)\n  > The veg patch needs water\.\n  > Garden again\./);
  assert.match(result, /- Plan\.md \(1 line\)\n  > Then the garden shed\./);
  assert.doesNotMatch(result, /Gardening|topic/);
  assert.match(result, /Outgoing links \(2\):\n- Seeds\.md\n- Compost \(no such note yet\)/);
});

test('get_links: a note nobody mentions; the earlier name still runs', async () => {
  const { result } = await api.executeTool(linksApp(), 'get_backlinks', { path: 'Diary.md' }, async () => '');
  assert.equal(api.toolLabels.toolLabel('get_backlinks', { path: 'Diary.md' }), 'Found links of Diary');
  assert.match(result, /Linked mentions: none\./);
  assert.match(result, /Unlinked mentions of "Diary": none\./);
  assert.match(result, /Outgoing links: none\./);
  const missing = await api.executeTool(linksApp(), 'get_links', { path: 'Nope.md' }, async () => '');
  assert.deepEqual(missing, { result: 'File not found: Nope.md', isError: true });
});


test('get_links: repeated mentions scan newline offsets once and keep exact line counts', async () => {
  const app = linksApp();
  const repeated = Array.from({ length: 4000 }, (_, i) => i % 2 ? 'Garden Garden' : 'Garden').join('\n');
  app.vault.cachedRead = async file => file.path === 'Diary.md' ? repeated : TEXT[file.path];
  app.metadataCache.getFileCache = file => file.path === 'Diary.md' ? {} : CACHE[file.path];
  const indexOf = String.prototype.indexOf;
  let scans = 0;
  String.prototype.indexOf = function(search, from) {
    if (String(this) === repeated && search === '\n') scans++;
    return indexOf.call(this, search, from);
  };
  let output;
  try { output = await api.executeTool(app, 'get_links', {}, async () => ''); }
  finally { String.prototype.indexOf = indexOf; }
  assert.equal(output.isError, false);
  assert.match(output.result, /Diary\.md \(4000 lines\)/);
  assert.ok(scans <= 4001, `newline rescans: ${scans}`);
});


test('Outgoing filenames and linked sources without cached lines report their folder rules', async () => {
  const app = linksApp();
  const original = app.vault.getFileByPath;
  app.vault.getFileByPath = path => path === 'Private/AGENTS.md' ? { path } : original(path);
  const read = app.vault.cachedRead;
  app.vault.cachedRead = async file => file.path === 'Private/AGENTS.md' ? 'OUTGOING-TARGET-RULE' : read(file);
  app.vault.getName = () => 'Test vault';
  app.vault.getFolderByPath = () => null;
  app.vault.getMarkdownFiles = () => []; // target is not part of the unrelated unlinked-content scan
  app.metadataCache.resolvedLinks['Garden.md'] = { 'Private/Secret.md': 1 };
  app.metadataCache.resolvedLinks['Uncached/Source.md'] = { 'Garden.md': 1 };
  const result = await api.executeTool(app, 'get_links', {}, async () => '');
  assert.ok(result.instructionPaths.includes('Private/Secret.md'));
  assert.ok(result.instructionPaths.includes('Uncached/Source.md'));
  const loop = new api.AgentLoop(app, settings('anthropic'));
  const requests = transport((_body, index) => index === 0
    ? response('anthropic', [call('links', 'get_links', {})], 'tool_use')
    : response('anthropic', [text('done')], 'end_turn', index));
  const cb = callbacks();
  await loop.run('Find links', cb);
  assert.deepEqual(cb.errors, []);
  assert.match(JSON.stringify(requests[1]), /OUTGOING-TARGET-RULE/);
});
