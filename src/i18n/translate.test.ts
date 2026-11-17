import { describe, expect, it } from 'vitest';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { translate } from './translate';

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

describe('translate', () => {
  it('returns the translation for the selected language', () => {
    expect(translate('fr', 'Done')).toBe('Terminé');
  });

  it('falls back to the English key when a translation is missing', () => {
    expect(translate('de', 'Some untranslated label')).toBe('Some untranslated label');
  });

  it('interpolates named placeholders and leaves unknown ones intact', () => {
    expect(translate('en', 'Autosaves every {minutes} min while you work', { minutes: 5 })).toBe(
      'Autosaves every 5 min while you work',
    );
    expect(translate('es', '{count} saved · applying one never changes your project audio.', {})).toBe(
      '{count} guardados · aplicar uno nunca cambia el audio de tu proyecto.',
    );
  });

  it('keeps the same placeholders in every translation as in the English source', () => {
    for (const [key, text] of Object.entries({ ...es, ...fr, ...de })) {
      expect(placeholders(text), key).toEqual(placeholders(key));
    }
  });
});
