import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  await Bun.file(new URL('../ui/app.ts', import.meta.url)).text()
);

async function render(status: number, operator = false, setup = false) {
  const elements = new Map<string, { hidden: boolean; textContent: string }>();
  runInNewContext(source, {
    crypto,
    document: {
      getElementById(id: string) {
        if (!elements.has(id))
          elements.set(id, { hidden: true, textContent: '' });
        return elements.get(id);
      },
    },
    fetch: async () =>
      Response.json(
        {
          subject: 'relay-subject',
          environment: 'production',
          operator,
          setup,
        },
        { status }
      ),
  });
  await Bun.sleep(0);
  return (id: string) => elements.get(id);
}

test('a signed-in nonoperator gets a dedicated denial and can sign out', async () => {
  const view = await render(200);
  expect(view('access-denied')?.hidden).toBe(false);
  expect(view('access-subject')?.textContent).toBe('relay-subject');
  expect(view('signed-in')?.hidden).toBe(false);
  expect(view('setup')?.hidden).toBe(true);
  expect(view('console')?.hidden).not.toBe(false);
});

test('first-operator bootstrap remains available without claiming access', async () => {
  const view = await render(200, false, true);
  expect(view('setup')?.hidden).toBe(false);
  expect(view('access-denied')?.hidden).toBe(true);
  expect(view('console')?.hidden).not.toBe(false);
});

test('anonymous users see sign-in and service failures do not claim access denial', async () => {
  expect((await render(401))('signed-out')?.hidden).toBe(false);
  const view = await render(503);
  expect(view('unavailable')?.hidden).toBe(false);
  expect(view('access-denied')?.hidden).not.toBe(false);
  expect(view('setup')?.hidden).not.toBe(false);
});
