import { useCallback } from 'react';
import { useApp } from '../store';
import { translate } from './translate';

export function useT() {
  const language = useApp((s) => s.settings.language);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
}
