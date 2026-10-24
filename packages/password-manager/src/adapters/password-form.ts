import type { Page } from 'playwright';
import { assertOrigin, fillSecret } from './browser-guard.ts';
import { ManagerError } from '../domain/errors.ts';
/** Reusable deterministic form primitive. Callers supply reviewed selectors,
 * trusted origin and values in protected memory, never page/agent instructions. */
export async function submitPasswordForm(input: {
  page: Page;
  origin: string;
  fields: readonly (readonly [string, string])[];
  button: RegExp;
}): Promise<void> {
  assertOrigin(input.page, input.origin);
  for (const [selector, value] of input.fields) {
    const locator = input.page.locator(selector);
    const length = await locator.evaluate((node) => ({
      min: (node as HTMLInputElement).minLength,
      max: (node as HTMLInputElement).maxLength,
    }));
    if (
      value.length < length.min ||
      (length.max >= 0 && value.length > length.max)
    )
      throw new ManagerError('requires-user-action');
    await fillSecret({
      page: input.page,
      locator,
      value,
      origin: input.origin,
    });
  }
  assertOrigin(input.page, input.origin);
  await input.page
    .getByRole('button', { name: input.button, exact: true })
    .click();
}
