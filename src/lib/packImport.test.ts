import assert from 'node:assert/strict';
import test from 'node:test';
import { importPackSafely, packImportErrorMessage } from './packImport.ts';

test('a rejected import reaches the UI error callback', async () => {
  const shown: string[] = [];
  const result = await importPackSafely(
    async () => {
      throw new Error('zip entry escapes the pack folder: ../../etc/passwd');
    },
    (message) => shown.push(message),
  );
  assert.equal(result, null);
  assert.deepEqual(shown, [
    'Could not import that pack: zip entry escapes the pack folder: ../../etc/passwd',
  ]);
});

test('empty and non-Error failures still produce a readable message', () => {
  assert.match(packImportErrorMessage(''), /Nothing was changed/);
  assert.match(packImportErrorMessage({}), /did not return an error message/);
  assert.equal(
    packImportErrorMessage(new Error('error: not a readable zip archive')),
    'Could not import that pack: not a readable zip archive',
  );
});
