import { describe, expect, it } from 'vitest';
import { importPackSafely, packImportErrorMessage } from './packImport.ts';

describe('pack import', () => {
  it('reaches the UI error callback when the import is rejected', async () => {
    const shown: string[] = [];
    const result = await importPackSafely(
      async () => {
        throw new Error('zip entry escapes the pack folder: ../../etc/passwd');
      },
      (message) => shown.push(message),
    );
    expect(result).toBeNull();
    expect(shown).toEqual([
      'Could not import that pack: zip entry escapes the pack folder: ../../etc/passwd',
    ]);
  });

  it('still produces a readable message for empty and non-Error failures', () => {
    expect(packImportErrorMessage('')).toMatch(/Nothing was changed/);
    expect(packImportErrorMessage({})).toMatch(/did not return an error message/);
    expect(packImportErrorMessage(new Error('error: not a readable zip archive'))).toBe(
      'Could not import that pack: not a readable zip archive',
    );
  });
});
