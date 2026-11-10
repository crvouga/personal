/**
 * `/index/` in the browser: the section chips and the search box filter the
 * items, the List/Grid buttons switch the layout (list on every load), `/`
 * focuses search, and the check time reads as "3 hours ago". The page works
 * without it as a list of everything.
 */

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export const relativeTime = (iso: string, now: number): string | null => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const elapsed = then - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size)
      return RELATIVE.format(Math.round(elapsed / size), unit);
  }
  return 'just now';
};

/** Every word of the query must appear somewhere in the card's text. */
export const matches = (search: string, query: string): boolean =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => search.includes(word));

const setPressed = (
  buttons: readonly HTMLButtonElement[],
  pressed: HTMLButtonElement
): void => {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button === pressed));
  }
};

export const initServiceIndex = (): void => {
  const root = document.querySelector<HTMLElement>('[data-service-index]');
  if (root === null) return;
  const input = root.querySelector<HTMLInputElement>('[data-search]');
  const chips = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button[data-category]')
  );
  const views = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button[data-view-button]')
  );
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-card]'));
  const sections = Array.from(
    root.querySelectorAll<HTMLElement>('[data-section]')
  );
  const empty = root.querySelector<HTMLElement>('[data-empty]');
  let category = 'all';

  const apply = (): void => {
    const query = input?.value ?? '';
    for (const card of cards) {
      card.hidden = !(
        (category === 'all' || card.dataset['category'] === category) &&
        matches(card.dataset['search'] ?? '', query)
      );
    }
    let shown = 0;
    for (const section of sections) {
      const visible = section.querySelectorAll('[data-card]:not([hidden])');
      section.hidden = visible.length === 0;
      shown += visible.length;
    }
    if (empty !== null) empty.hidden = shown > 0;
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      category = chip.dataset['category'] ?? 'all';
      setPressed(chips, chip);
      apply();
    });
  }
  for (const button of views) {
    button.addEventListener('click', () => {
      root.dataset['view'] = button.dataset['viewButton'] ?? 'list';
      setPressed(views, button);
    });
  }
  input?.addEventListener('input', apply);
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (event.key === '/' && !typing && input !== null) {
      event.preventDefault();
      input.focus();
    }
  });

  const time = root.querySelector<HTMLTimeElement>('time[data-relative]');
  const label = time === null ? null : relativeTime(time.dateTime, Date.now());
  if (time !== null && label !== null) {
    time.title = time.textContent ?? '';
    time.textContent = label;
  }
};
