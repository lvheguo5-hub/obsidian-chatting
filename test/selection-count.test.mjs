import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

const { countSelection, selectionCountLabel } = api.selectionCount;

test('Chinese, Japanese and Korean characters each count as a word', () => {
  assert.deepEqual(countSelection('你好，世界！'), { words: 4, characters: 6 });
  assert.deepEqual(countSelection('日本語かなカナ 한글'), { words: 9, characters: 10 });
  assert.deepEqual(countSelection('コーヒー'), { words: 4, characters: 4 });
  assert.deepEqual(countSelection('𠮷野家'), { words: 3, characters: 4 });
});

test('English words and numbers stay together, including next to CJK text', () => {
  assert.deepEqual(countSelection('Hello, world!'), { words: 2, characters: 13 });
  assert.deepEqual(countSelection('中文Hello2026世界'), { words: 5, characters: 13 });
  assert.deepEqual(countSelection('123 456 abc123 １２３'), { words: 4, characters: 18 });
});

test('Internal apostrophes and hyphens stay in words; punctuation alone is not a word', () => {
  assert.deepEqual(countSelection("don't re-read can’t"), { words: 3, characters: 19 });
  assert.deepEqual(countSelection('，。！？... -- “ ”'), { words: 0, characters: 14 });
  assert.deepEqual(countSelection('one/two,three—four'), { words: 4, characters: 18 });
});

test('Whitespace separates words and still counts toward characters', () => {
  assert.deepEqual(countSelection(''), { words: 0, characters: 0 });
  assert.deepEqual(countSelection(' \t\n\r\n '), { words: 0, characters: 6 });
  assert.deepEqual(countSelection('  Hello\n世界\t42\r\n'), { words: 4, characters: 15 });
});

test('Character counts use UTF-16 length, including emoji and combining marks', () => {
  assert.deepEqual(countSelection('😀'), { words: 0, characters: 2 });
  assert.deepEqual(countSelection('cafe\u0301'), { words: 1, characters: 5 });
});

test('Counts include the full selection beyond the 80-character preview', () => {
  assert.deepEqual(countSelection('中文 hello 123\n'.repeat(100)), { words: 400, characters: 1300 });
});

test('The label uses singular and plural words and characters independently', () => {
  assert.equal(selectionCountLabel(''), '0 words · 0 characters');
  assert.equal(selectionCountLabel('中'), '1 word · 1 character');
  assert.equal(selectionCountLabel('hello'), '1 word · 5 characters');
  assert.equal(selectionCountLabel('!'), '0 words · 1 character');
  assert.equal(selectionCountLabel('a b'), '2 words · 3 characters');
});
