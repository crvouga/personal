import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import {
  readThemePreference,
  resolveTheme,
  themeStorageKey,
} from '../ui/theme-preference';
import { ThemePicker } from '../ui/theme-picker';

const build = await Bun.build({
  entrypoints: [fileURLToPath(new URL('../ui/theme-init.ts', import.meta.url))],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!build.success) throw new Error('Theme bootstrap did not build');
const bootstrap = await build.outputs[0]!.text();

function initialTheme(
  saved: string | null,
  prefersDark: boolean,
  blocked = false
) {
  let theme = '';
  runInNewContext(bootstrap, {
    window: {
      localStorage: {
        getItem(key: string) {
          expect(key).toBe(themeStorageKey);
          if (blocked) throw new Error('Storage blocked');
          return saved;
        },
      },
      matchMedia: (query: string) => {
        expect(query).toBe('(prefers-color-scheme: dark)');
        return { matches: prefersDark };
      },
    },
    document: {
      documentElement: {
        setAttribute(key: string, value: string) {
          expect(key).toBe('data-mantine-color-scheme');
          theme = value;
        },
      },
    },
  });
  return theme;
}

test('the early theme script defaults to the system and applies explicit choices before React', () => {
  expect(initialTheme(null, true)).toBe('dark');
  expect(initialTheme(null, false)).toBe('light');
  expect(initialTheme('auto', true)).toBe('dark');
  expect(initialTheme('light', true)).toBe('light');
  expect(initialTheme('dark', false)).toBe('dark');
});

test('blocked storage and invalid preferences safely use the operating system theme', () => {
  expect(initialTheme('invalid', true)).toBe('dark');
  expect(initialTheme('light', true, true)).toBe('dark');
  expect(readThemePreference(() => null)).toBe('auto');
  expect(
    readThemePreference(() => {
      throw new Error('Storage blocked');
    })
  ).toBe('auto');
});

test('only system mode follows changes to the operating system appearance', () => {
  expect(resolveTheme('auto', true)).toBe('dark');
  expect(resolveTheme('auto', false)).toBe('light');
  expect(resolveTheme('light', true)).toBe('light');
  expect(resolveTheme('dark', false)).toBe('dark');
});

test('theme controls expose their selected mode to keyboard and screen reader users', () => {
  for (const [mode, label] of [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['auto', 'System'],
  ] as const) {
    const html = renderToStaticMarkup(
      <MantineProvider defaultColorScheme={mode} env="test">
        <ThemePicker />
      </MantineProvider>
    );
    expect(html).toContain(`aria-label="Color theme: ${label}"`);
    expect(html).toContain('aria-haspopup="menu"');
  }
});
