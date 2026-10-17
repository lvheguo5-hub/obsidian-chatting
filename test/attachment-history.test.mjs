import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, text } from './harness.mjs';
const { boundConversationAttachments: bound, retainedAttachmentBytes: bytes } = api.attachmentHistory;
const file = (id, data = 'A'.repeat(100)) => ({ id, fileName: `${id}.pdf`, mediaType: 'application/pdf', sizeBytes: 75, data });
function conversation(id, updatedAt, attachment) {
  const record = api.chatState.newConversation(updatedAt);
  Object.assign(record, { id, updatedAt, title: id });
  record.agentMessages = [{ role: 'user', turnId: id, content: [{ type: 'file', file: attachment }, text(id)] }];
  record.chatHistory = [{ type: 'user', turnId: id, text: id, attachedFiles: [attachment] }];
  return record;
}

test('Retention measures escaped UTF-8 payloads conservatively without trusting source-size metadata', () => {
  for (const value of ['ASCII', '\u0000\n"\\', '中文😀', '\ud800']) {
    const attachment = { ...file('utf8'), sizeBytes: 0, text: value };
    assert.ok(bytes(attachment) >= Buffer.byteLength(JSON.stringify(attachment)));
    attachment.text += ' changed';
    assert.ok(bytes(attachment) >= Buffer.byteLength(JSON.stringify(attachment)));
  }
});

test('A shared budget prioritizes active then recently used chats and releases API and visible payloads', () => {
  const attachments = ['active', 'new', 'old'].map(id => file(id));
  const records = attachments.map((attachment, i) => conversation(attachment.id, 100 - i, attachment));
  records[0].updatedAt = 0;
  const oldEntry = records[2].chatHistory[0];
  const result = bound(records, 'active', bytes(attachments[0]) + bytes(attachments[1]));
  assert.equal(result.omitted, 1);
  assert.ok(result.changed.has('old'));
  assert.equal(records[2].chatHistory[0], oldEntry);
  assert.equal(oldEntry.attachedFiles[0].data, '');
  assert.match(records[2].agentMessages[0].content[0].text, /old.pdf.*Reattach/);
  assert.equal(records[0].agentMessages[0].content[0].file, attachments[0]);
  assert.equal(records[1].agentMessages[0].content[0].file, attachments[1]);
  assert.equal(bound(records, 'active', bytes(attachments[0]) + bytes(attachments[1])).omitted, 0);
});

test('Tool attachment expiration preserves call/result pairing, provenance and in-flight result arrays', () => {
  const record = conversation('active', 1, file('user'));
  const result = { type: 'tool_result', tool_use_id: 'read', content: 'Read file', files: [file('tool')], instructionSources: ['Work/AGENTS.md'] };
  const results = [result];
  record.agentMessages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'read', name: 'read_file', input: {} }] }, { role: 'user', content: results });
  bound([record], 'active', 0);
  assert.equal(record.agentMessages.at(-1).content, results);
  assert.equal(results[0], result);
  assert.deepEqual(result.files, []);
  assert.equal(result.tool_use_id, 'read');
  assert.deepEqual(result.instructionSources, ['Work/AGENTS.md']);
  assert.match(result.content, /tool.pdf/);
});

test('Repeated attachment occurrences each consume serialized budget, even with the same object', () => {
  const attachment = file('shared');
  const record = conversation('active', 1, attachment);
  record.agentMessages.push({ role: 'assistant', content: [text('ok')] }, { role: 'user', content: [{ type: 'file', file: attachment }, text('again')] });
  bound([record], 'active', bytes(attachment));
  assert.equal(record.agentMessages.at(-1).content[0].file, attachment);
  assert.equal(record.agentMessages[0].content[0].type, 'text');
});

test('Legacy visible-only data shares the same budget and becomes a named chip when expired', () => {
  const record = api.chatState.newConversation();
  record.chatHistory.push({ type: 'user', text: 'Legacy', images: [{ ...file('legacy'), mediaType: 'image/png' }] });
  const result = bound([record], record.id, 0);
  assert.equal(result.omitted, 1);
  assert.equal(record.chatHistory[0].images[0].data, '');
  assert.equal(record.chatHistory[0].images[0].fileName, 'legacy.pdf');
});
