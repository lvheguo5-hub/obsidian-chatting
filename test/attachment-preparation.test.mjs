import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

test('Attachment preparation stays loading until every active job finishes and ignores repeated completion', () => {
  const states = [];
  const pending = new api.AttachmentPreparation(loading => states.push(loading));
  const first = pending.begin(), second = pending.begin();
  assert.equal(pending.loading, true);
  first.finish();
  assert.equal(pending.loading, true);
  first.finish();
  second.finish();
  assert.equal(pending.loading, false);
  assert.deepEqual(states, [true, true, true, false]);
});

test('A late attachment cannot enter a reset composer or unlock a newer pending load', async () => {
  const pending = new api.AttachmentPreparation(() => {});
  const old = pending.begin();
  let complete;
  const file = new Promise(resolve => { complete = resolve; });
  const draft = [];
  const loading = (async () => { const value = await file; old.commit(() => draft.push(value)); old.finish(); })();
  pending.cancel();
  const next = pending.begin();
  complete('old file');
  await loading;
  assert.deepEqual(draft, []);
  assert.equal(pending.loading, true);
  next.commit(() => draft.push('new file'));
  next.finish();
  assert.equal(pending.loading, false);
  assert.deepEqual(draft, ['new file']);
});
