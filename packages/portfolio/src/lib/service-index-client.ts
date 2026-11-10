/**
 * `/index/` in the browser: the category chips and the search box filter the
 * grid, `/` focuses search, and the check time reads as "3 hours ago". The
 * page works without it; this only narrows what is shown.
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

export const initServiceIndex = (): void => {
  const root = document.querySelector<HTMLElement>('[data-service-index]');
  if (root === null) return;
  const input = root.querySelector<HTMLInputElement>('[data-search]');
  const chips = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-category]')
  ).filter((element) => element.tagName === 'BUTTON');
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-card]'));
  const empty = root.querySelector<HTMLElement>('[data-empty]');
  let category = 'all';

  const apply = (): void => {
    const query = input?.value ?? '';
    let shownOpen = 0;
    for (const card of cards) {
      const show =
        (category === 'all' || card.dataset['category'] === category) &&
        matches(card.dataset['search'] ?? '', query);
      card.hidden = !show;
      if (show && card.closest('details') === null) shownOpen += 1;
    }
    if (empty !== null) empty.hidden = shownOpen > 0;
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      category = chip.dataset['category'] ?? 'all';
      for (const other of chips) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      apply();
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
