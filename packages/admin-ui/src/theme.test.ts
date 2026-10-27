import { expect, test } from 'bun:test';
import { readThemePreference, resolveTheme } from './theme';
test('explicit and system appearance handle unavailable storage safely', () => {
  expect(readThemePreference(() => 'dark')).toBe('dark');
  expect(
    readThemePreference(() => {
      throw new Error('Blocked');
    })
  ).toBe('auto');
  expect(resolveTheme('auto', true)).toBe('dark');
  expect(resolveTheme('light', true)).toBe('light');
});
