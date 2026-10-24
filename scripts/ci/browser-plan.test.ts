import { expect, test } from 'bun:test';
import { needsBrowser } from './browser-plan';

const task = (
  status: string,
  directory = 'packages/browser',
  name = 'test'
) => ({
  task: name,
  directory,
  cache: { status },
});
const browser = { devDependencies: { '@playwright/test': '1.63.0' } };

test('cached browser tasks do not install Chromium, even when other tasks execute', () => {
  expect(
    needsBrowser(
      { tasks: [task('HIT'), task('MISS', 'packages/plain')] },
      (directory) =>
        directory === 'packages/browser'
          ? browser
          : { scripts: { test: 'bun test' } }
    )
  ).toBe(false);
});

test('an uncached browser build or test still installs Chromium', () => {
  for (const name of ['test', 'build'])
    for (const dependency of ['playwright', '@playwright/test'])
      expect(
        needsBrowser(
          { tasks: [task('MISS', 'packages/browser', name)] },
          () => ({
            dependencies: { [dependency]: 'fixture' },
          })
        )
      ).toBe(true);
});

test('typechecks do not require Chromium', () => {
  expect(
    needsBrowser(
      { tasks: [task('MISS', 'packages/browser', 'tc')] },
      () => browser
    )
  ).toBe(false);
});

test('missing manifests and malformed plans conservatively install browsers', () => {
  for (const plan of [
    null,
    {},
    { tasks: [] },
    { tasks: [null] },
    { tasks: [{}] },
    { tasks: [{ task: 'test' }] },
  ])
    expect(needsBrowser(plan, () => ({}))).toBe(true);
  expect(
    needsBrowser({ tasks: [task('MISS')] }, () => {
      throw new Error('missing');
    })
  ).toBe(true);
});
