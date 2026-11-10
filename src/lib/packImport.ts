/**
 * Error plumbing for pack imports. The native command rejects on real failures;
 * this keeps the message shown in the UI consistent and testable.
 */

export function packImportErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'The desktop importer did not return an error message.';
  const detail = raw.replace(/^error:\s*/i, '').trim();
  return detail
    ? `Could not import that pack: ${detail}`
    : 'Could not import that pack. Nothing was changed.';
}

/** Runs an import and reports failures through the UI's toast callback. */
export async function importPackSafely<T>(
  run: () => Promise<T>,
  onError: (message: string) => void,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error('Pack import failed', error);
    onError(packImportErrorMessage(error));
    return null;
  }
}
